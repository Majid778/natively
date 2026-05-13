import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import https from 'https';
import { ChildProcess, spawn } from 'child_process';
import treeKill from 'tree-kill';

export interface WhisperCppEnsureResult {
    success: boolean;
    started: boolean;
    error?: string;
    message?: string;
}

const DEFAULT_ENDPOINT = 'http://127.0.0.1:8000/v1/audio/transcriptions';
const DEFAULT_RELEASE_URL = 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.4/whisper-bin-x64.zip';
const DEFAULT_MODEL_ID = 'large-v3-turbo';
const DEFAULT_MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin';

const MODEL_ASSETS: Record<string, { fileName: string; url: string }> = {
    'large-v3-turbo': {
        fileName: 'ggml-large-v3-turbo-q5_0.bin',
        url: DEFAULT_MODEL_URL,
    },
    'whisper-large-v3-turbo': {
        fileName: 'ggml-large-v3-turbo-q5_0.bin',
        url: DEFAULT_MODEL_URL,
    },
    base: {
        fileName: 'ggml-base.bin',
        url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
    },
    small: {
        fileName: 'ggml-small.bin',
        url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
    },
};

interface WhisperCppAssets {
    serverPath: string;
    modelPath: string;
}

export class WhisperCppManager {
    private static instance: WhisperCppManager;
    private processRef: ChildProcess | null = null;
    private isAppManaged = false;
    private ensurePromise: Promise<WhisperCppEnsureResult> | null = null;

    private constructor() {}

    public static getInstance(): WhisperCppManager {
        if (!WhisperCppManager.instance) {
            WhisperCppManager.instance = new WhisperCppManager();
        }
        return WhisperCppManager.instance;
    }

    public async ensureRunning(context: string): Promise<WhisperCppEnsureResult> {
        if (this.ensurePromise) return this.ensurePromise;

        this.ensurePromise = this.ensureRunningInternal(context).finally(() => {
            this.ensurePromise = null;
        });

        return this.ensurePromise;
    }

    public stop(): void {
        if (!this.isAppManaged || !this.processRef?.pid) return;

        const pid = this.processRef.pid;
        const processRef = this.processRef;
        console.log(`[WhisperCppManager] Stopping managed whisper.cpp process tree (PID=${pid})...`);

        if (processRef.exitCode !== null) {
            this.processRef = null;
            this.isAppManaged = false;
            return;
        }

        try {
            treeKill(pid, 'SIGTERM', (err) => {
                if (err) {
                    const message = String((err as any)?.message || err || '');
                    if (/not found|no such process|does not exist/i.test(message)) {
                        console.log('[WhisperCppManager] whisper.cpp process already exited.');
                    } else {
                        console.error('[WhisperCppManager] Failed to stop whisper.cpp process tree:', err);
                    }
                } else {
                    console.log('[WhisperCppManager] Managed whisper.cpp process stopped.');
                }
            });
        } catch (err) {
            console.error('[WhisperCppManager] Exception while stopping whisper.cpp process:', err);
        } finally {
            this.processRef = null;
            this.isAppManaged = false;
        }
    }

    private async ensureRunningInternal(context: string): Promise<WhisperCppEnsureResult> {
        if (await this.checkIsRunning()) {
            console.log('[WhisperCppManager] whisper.cpp server is already running.');
            return { success: true, started: false, message: 'already-running' };
        }

        const endpoint = this.getEndpointUrl();
        if (!this.isLocalEndpoint(endpoint)) {
            return {
                success: false,
                started: false,
                error: `Local transcription endpoint is non-local (${endpoint.origin}). Use a localhost endpoint or start it manually.`,
            };
        }

        const envCommand = process.env.WHISPERCPP_START_COMMAND?.trim();
        if (envCommand) {
            const attempt = await this.tryStart(envCommand, this.getStartupTimeoutMs());
            if (attempt.started) return { success: true, started: true, message: 'started-env-command' };
            return { success: false, started: false, error: attempt.error || 'Configured WHISPERCPP_START_COMMAND failed.' };
        }

        let assets: WhisperCppAssets;
        try {
            assets = await this.ensureAssets();
        } catch (err) {
            return {
                success: false,
                started: false,
                error: err instanceof Error ? err.message : String(err),
            };
        }

        const command = this.buildServerCommand(endpoint, assets);
        const attempt = await this.tryStart(command, this.getStartupTimeoutMs());
        if (attempt.started) {
            console.log(`[WhisperCppManager] whisper.cpp started for ${context}.`);
            return { success: true, started: true, message: 'started' };
        }

        return {
            success: false,
            started: false,
            error: attempt.error || 'Failed to start local whisper.cpp server.',
        };
    }

    private async ensureAssets(): Promise<WhisperCppAssets> {
        const assetsDir = this.getAssetsDir();
        const binDir = path.join(assetsDir, 'bin');
        const modelDir = path.join(assetsDir, 'models');
        fs.mkdirSync(binDir, { recursive: true });
        fs.mkdirSync(modelDir, { recursive: true });

        const configuredBinaryDir = process.env.WHISPERCPP_BINARY_DIR?.trim();
        const serverPath = configuredBinaryDir
            ? this.findServerExecutable(configuredBinaryDir)
            : await this.ensureServerExecutable(binDir);

        const modelPath = await this.ensureModelFile(modelDir);
        return { serverPath, modelPath };
    }

    private async ensureServerExecutable(binDir: string): Promise<string> {
        const existing = this.findServerExecutable(binDir, false);
        if (existing) return existing;

        const zipPath = path.join(binDir, 'whisper-bin-x64.zip');
        const releaseUrl = process.env.WHISPERCPP_RELEASE_URL?.trim() || DEFAULT_RELEASE_URL;
        console.log(`[WhisperCppManager] Downloading whisper.cpp Windows binary from ${releaseUrl}`);
        await this.downloadFile(releaseUrl, zipPath);
        await this.extractZip(zipPath, binDir);

        const extracted = this.findServerExecutable(binDir, false);
        if (!extracted) {
            throw new Error('Downloaded whisper.cpp package did not contain whisper-server.exe.');
        }
        return extracted;
    }

    private async ensureModelFile(modelDir: string): Promise<string> {
        const configured = process.env.WHISPERCPP_MODEL_PATH?.trim();
        if (configured) {
            if (!fs.existsSync(configured)) throw new Error(`WHISPERCPP_MODEL_PATH does not exist: ${configured}`);
            return configured;
        }

        const model = this.resolveModelAsset();
        const modelPath = path.join(modelDir, model.fileName);
        if (fs.existsSync(modelPath) && fs.statSync(modelPath).size > 1024 * 1024) {
            return modelPath;
        }

        console.log(`[WhisperCppManager] Downloading local transcription model ${model.fileName}. This can take a while on first run.`);
        await this.downloadFile(process.env.WHISPERCPP_MODEL_URL?.trim() || model.url, modelPath);
        return modelPath;
    }

    private resolveModelAsset(): { fileName: string; url: string } {
        const configured = this.getConfiguredModel().trim().toLowerCase();
        return MODEL_ASSETS[configured] || MODEL_ASSETS[DEFAULT_MODEL_ID];
    }

    private getConfiguredModel(): string {
        try {
            const { CredentialsManager } = require('./CredentialsManager');
            return CredentialsManager.getInstance().getLocalSttModel() || DEFAULT_MODEL_ID;
        } catch {
            return DEFAULT_MODEL_ID;
        }
    }

    private getAssetsDir(): string {
        return process.env.WHISPERCPP_ASSETS_DIR?.trim() || path.join(app.getPath('userData'), 'whisper.cpp');
    }

    private findServerExecutable(root: string, throwIfMissing = true): string {
        const direct = path.join(root, process.platform === 'win32' ? 'whisper-server.exe' : 'whisper-server');
        if (fs.existsSync(direct)) return direct;

        const stack = [root];
        while (stack.length > 0) {
            const current = stack.pop()!;
            if (!fs.existsSync(current)) continue;
            const entries = fs.readdirSync(current, { withFileTypes: true });
            for (const entry of entries) {
                const full = path.join(current, entry.name);
                if (entry.isDirectory()) stack.push(full);
                if (entry.isFile() && /^whisper-server(\.exe)?$/i.test(entry.name)) return full;
            }
        }

        if (throwIfMissing) throw new Error(`whisper-server executable not found in ${root}`);
        return '';
    }

    private buildServerCommand(endpoint: URL, assets: WhisperCppAssets): string {
        const host = endpoint.hostname || '127.0.0.1';
        const port = endpoint.port || '8000';
        const inferencePath = endpoint.pathname || '/v1/audio/transcriptions';
        const threads = process.env.WHISPERCPP_THREADS?.trim() || String(Math.max(2, Math.min(8, Math.floor((require('os').cpus()?.length || 4) / 2))));
        const noGpu = process.env.WHISPERCPP_NO_GPU === '1' ? ' --no-gpu' : '';

        return [
            this.quote(assets.serverPath),
            '--host', host,
            '--port', port,
            '--inference-path', this.quote(inferencePath),
            '-m', this.quote(assets.modelPath),
            '-l', 'auto',
            '-nt',
            '-sns',
            '-t', threads,
            noGpu,
        ].filter(Boolean).join(' ');
    }

    private async tryStart(command: string, timeoutMs: number): Promise<{ started: boolean; error?: string }> {
        console.log(`[WhisperCppManager] Starting: ${command}`);
        let stderrTail = '';
        let stdoutTail = '';

        const child = spawn(command, {
            shell: true,
            detached: false,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        this.processRef = child;
        this.isAppManaged = true;

        child.stdout?.on('data', (chunk: Buffer | string) => {
            const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
            stdoutTail = (stdoutTail + text).slice(-2000);
        });
        child.stderr?.on('data', (chunk: Buffer | string) => {
            const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
            stderrTail = (stderrTail + text).slice(-3000);
        });

        child.on('error', (err) => {
            console.error('[WhisperCppManager] Startup process error:', err.message);
        });

        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
            if (await this.checkIsRunning()) {
                console.log('[WhisperCppManager] Endpoint is responsive.');
                return { started: true };
            }

            if (child.exitCode !== null) {
                const tail = this.lastLogLine(stderrTail || stdoutTail) || `exit code ${child.exitCode}`;
                this.processRef = null;
                this.isAppManaged = false;
                return { started: false, error: tail };
            }

            await this.sleep(1000);
        }

        const tail = this.lastLogLine(stderrTail || stdoutTail);
        this.stop();
        return { started: false, error: tail || 'Timed out waiting for whisper.cpp server to start.' };
    }

    private async checkIsRunning(): Promise<boolean> {
        const endpoint = this.getEndpointUrl();
        const checks = [
            { url: endpoint.toString(), method: 'OPTIONS' as const },
            { url: `${endpoint.origin}/`, method: 'GET' as const },
        ];

        for (const check of checks) {
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 1200);
                const response = await fetch(check.url, { method: check.method, signal: controller.signal });
                clearTimeout(timeout);
                if (response.status < 500) return true;
            } catch {
                // Try next probe.
            }
        }

        return false;
    }

    private getEndpointUrl(): URL {
        const raw = process.env.WHISPERCPP_ENDPOINT?.trim()
            || DEFAULT_ENDPOINT;
        try {
            return new URL(raw);
        } catch {
            return new URL(DEFAULT_ENDPOINT);
        }
    }

    private isLocalEndpoint(url: URL): boolean {
        const host = url.hostname.toLowerCase();
        return host === '127.0.0.1' || host === 'localhost' || host === '::1';
    }

    private getStartupTimeoutMs(): number {
        const raw = process.env.WHISPERCPP_STARTUP_TIMEOUT_MS?.trim();
        const parsed = raw ? Number(raw) : NaN;
        if (!Number.isFinite(parsed) || parsed <= 0) return 120000;
        return parsed;
    }

    private async downloadFile(url: string, destination: string): Promise<void> {
        const tempPath = `${destination}.download`;
        if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
        fs.mkdirSync(path.dirname(destination), { recursive: true });

        await new Promise<void>((resolve, reject) => {
            const request = (target: string, redirects = 0) => {
                const req = https.get(target, { headers: { 'User-Agent': 'Natively-OSS' } }, (res) => {
                    if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                        if (redirects > 5) {
                            reject(new Error(`Too many redirects while downloading ${url}`));
                            return;
                        }
                        request(new URL(res.headers.location, target).toString(), redirects + 1);
                        return;
                    }

                    if (res.statusCode !== 200) {
                        reject(new Error(`Download failed (${res.statusCode}) for ${url}`));
                        return;
                    }

                    const file = fs.createWriteStream(tempPath);
                    res.pipe(file);
                    file.on('finish', () => file.close(() => resolve()));
                    file.on('error', reject);
                });
                req.on('error', reject);
            };
            request(url);
        });

        fs.renameSync(tempPath, destination);
    }

    private async extractZip(zipPath: string, destination: string): Promise<void> {
        if (process.platform !== 'win32') {
            throw new Error('Automatic whisper.cpp binary extraction is currently implemented for Windows builds only.');
        }

        const ps = spawn('powershell.exe', [
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-Command',
            `Expand-Archive -LiteralPath ${this.psQuote(zipPath)} -DestinationPath ${this.psQuote(destination)} -Force`,
        ], {
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stderr = '';
        ps.stderr?.on('data', (chunk) => { stderr += chunk.toString('utf8'); });

        const code = await new Promise<number | null>((resolve) => ps.on('close', resolve));
        if (code !== 0) {
            throw new Error(`Failed to extract whisper.cpp binary: ${this.lastLogLine(stderr) || `exit code ${code}`}`);
        }
    }

    private quote(value: string): string {
        return `"${value.replace(/"/g, '\\"')}"`;
    }

    private psQuote(value: string): string {
        return `'${value.replace(/'/g, "''")}'`;
    }

    private lastLogLine(text: string): string {
        return text.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] || '';
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
