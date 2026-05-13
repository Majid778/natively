import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, CheckCircle, ExternalLink, Loader2, Save } from 'lucide-react';

interface OpenRouterKeyInfo {
    label?: string;
    usage?: number | null;
    limit?: number | null;
    limitRemaining?: number | null;
    hasCredits?: boolean;
    isFreeTier?: boolean;
}

type OpenRouterValidationResult = OpenRouterKeyInfo & {
    success: boolean;
    error?: string;
};

const OPENROUTER_KEYS_URL = 'https://openrouter.ai/settings/keys';
const OPENROUTER_CREDITS_URL = 'https://openrouter.ai/settings/credits';
const OPENROUTER_MODEL_ID = 'google/gemini-2.5-flash';
const OPENROUTER_PROVIDER_ID = 'openrouter-google-gemini-2-5-flash';
const OPENROUTER_MODEL_LABEL = 'Google Gemini 2.5 Flash';
const DEEPGRAM_KEYS_URL = 'https://console.deepgram.com/project/keys';

const buildOpenRouterCurl = (apiKey: string): string =>
    `curl https://openrouter.ai/api/v1/chat/completions -H "Authorization: Bearer ${apiKey}" -H "Content-Type: application/json" -H "X-Title: Natively" -d '{"model":"${OPENROUTER_MODEL_ID}","messages":[{"role":"user","content":"{{TEXT}}"}],"temperature":0.2}'`;

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
};

const getSupportedAudioMimeType = (): string | undefined => {
    const candidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/ogg',
    ];
    return candidates.find((type) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type));
};

const recordMicrophoneSample = async (): Promise<{ audioBase64: string; mimeType: string }> => {
    if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone access is unavailable. Check Windows privacy settings and try again.');
    }
    if (typeof MediaRecorder === 'undefined') {
        throw new Error('This browser window cannot record a mic sample. Restart the app and try again.');
    }

    let stream: MediaStream | null = null;
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mimeType = getSupportedAudioMimeType();
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        const chunks: BlobPart[] = [];

        return await new Promise((resolve, reject) => {
            const timeout = window.setTimeout(() => {
                if (recorder.state !== 'inactive') recorder.stop();
            }, 3200);

            recorder.ondataavailable = (event) => {
                if (event.data.size > 0) chunks.push(event.data);
            };
            recorder.onerror = () => {
                window.clearTimeout(timeout);
                reject(new Error('Microphone recording failed. Check the selected input device.'));
            };
            recorder.onstop = async () => {
                window.clearTimeout(timeout);
                try {
                    const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
                    if (blob.size === 0) throw new Error('No microphone audio was captured. Speak during the 3-second test.');
                    resolve({
                        audioBase64: arrayBufferToBase64(await blob.arrayBuffer()),
                        mimeType: blob.type || 'audio/webm',
                    });
                } catch (error) {
                    reject(error);
                }
            };

            recorder.start();
        });
    } finally {
        stream?.getTracks().forEach((track) => track.stop());
    }
};

const StatusPill = ({ ready, label }: { ready: boolean; label: string }) => (
    <span className={`text-[10px] font-semibold px-2 py-1 rounded-full border ${
        ready
            ? 'bg-green-500/10 border-green-500/20 text-green-400'
            : 'bg-bg-input border-border-subtle text-text-tertiary'
    }`}>
        {label}
    </span>
);

export const AIProvidersSettings: React.FC = () => {
    const [openRouterApiKey, setOpenRouterApiKey] = useState('');
    const [deepgramApiKey, setDeepgramApiKey] = useState('');
    const [hasStoredOpenRouterKey, setHasStoredOpenRouterKey] = useState(false);
    const [hasStoredDeepgramKey, setHasStoredDeepgramKey] = useState(false);

    const [openRouterStatus, setOpenRouterStatus] = useState<'idle' | 'saving' | 'testing' | 'success' | 'error'>('idle');
    const [deepgramStatus, setDeepgramStatus] = useState<'idle' | 'saving' | 'testing' | 'success' | 'error'>('idle');
    const [openRouterMessage, setOpenRouterMessage] = useState<string | null>(null);
    const [deepgramMessage, setDeepgramMessage] = useState<string | null>(null);

    useEffect(() => {
        const loadCredentials = async () => {
            try {
                const creds = await window.electronAPI?.getStoredCredentials?.();
                if (!creds) return;

                setHasStoredOpenRouterKey(Boolean(creds.hasOpenRouterKey || creds.openRouterApiKey));
                setHasStoredDeepgramKey(Boolean(creds.hasDeepgramKey || creds.sttDeepgramKey));

                if (creds.openRouterApiKey) setOpenRouterApiKey(creds.openRouterApiKey);
                if (creds.sttDeepgramKey) setDeepgramApiKey(creds.sttDeepgramKey);
            } catch (error) {
                console.error('Failed to load AI provider settings:', error);
            }
        };

        loadCredentials();
    }, []);

    const textProviderReady = useMemo(
        () => hasStoredOpenRouterKey || openRouterStatus === 'success',
        [hasStoredOpenRouterKey, openRouterStatus]
    );
    const transcriptionReady = useMemo(
        () => hasStoredDeepgramKey || deepgramStatus === 'success',
        [hasStoredDeepgramKey, deepgramStatus]
    );

    const validateOpenRouterKey = async (): Promise<OpenRouterValidationResult> => {
        const key = openRouterApiKey.trim();
        if (!key) return { success: false, error: 'Paste your OpenRouter key first.' };
        if (!key.startsWith('sk-or-v1-')) return { success: false, error: 'OpenRouter keys start with sk-or-v1-.' };

        const result = await window.electronAPI?.validateOpenRouterKey?.(key);
        if (!result?.success) return { success: false, error: result?.error || 'OpenRouter key failed validation.' };
        return result;
    };

    const saveOpenRouter = async () => {
        setOpenRouterStatus('saving');
        setOpenRouterMessage(null);

        try {
            const key = openRouterApiKey.trim();
            const validation = await validateOpenRouterKey();
            if (!validation.success) throw new Error(validation.error);
            if (validation.hasCredits === false) throw new Error('Key is valid, but OpenRouter has no remaining credits.');

            await window.electronAPI?.setOpenRouterApiKey?.(key);

            const saved = await window.electronAPI?.saveCustomProvider?.({
                id: OPENROUTER_PROVIDER_ID,
                name: `OpenRouter (${OPENROUTER_MODEL_LABEL})`,
                curlCommand: buildOpenRouterCurl(key),
                responsePath: 'choices[0].message.content',
            });
            if (!saved?.success) throw new Error(saved?.error || 'Failed to save OpenRouter.');

            const defaultResult = await window.electronAPI?.setDefaultModel?.(OPENROUTER_PROVIDER_ID);
            if (defaultResult && !defaultResult.success) throw new Error(defaultResult.error || 'Failed to set text model.');

            setHasStoredOpenRouterKey(true);
            setOpenRouterStatus('success');
            setOpenRouterMessage('Text model saved.');
        } catch (error: any) {
            setOpenRouterStatus('error');
            setOpenRouterMessage(error?.message || 'Failed to save OpenRouter.');
        }
    };

    const testOpenRouter = async () => {
        setOpenRouterStatus('testing');
        setOpenRouterMessage(null);

        try {
            await window.electronAPI?.setDefaultModel?.(OPENROUTER_PROVIDER_ID);
            const result = await window.electronAPI?.generateSuggestion?.(
                'Provider test.',
                'Reply with OK.'
            );
            if (!result?.suggestion) throw new Error('No response returned from Gemini Flash.');

            setOpenRouterStatus('success');
            setOpenRouterMessage('Text model works.');
        } catch (error: any) {
            setOpenRouterStatus('error');
            setOpenRouterMessage(error?.message || 'Gemini Flash test failed.');
        }
    };

    const saveDeepgram = async () => {
        setDeepgramStatus('saving');
        setDeepgramMessage(null);

        try {
            const key = deepgramApiKey.trim();
            if (!key) throw new Error('Paste your Deepgram key first.');

            const saved = await window.electronAPI?.setDeepgramApiKey?.(key);
            if (saved && !saved.success) throw new Error(saved.error || 'Failed to save Deepgram.');

            const providerSet = await window.electronAPI?.setSttProvider?.('deepgram');
            if (providerSet && !providerSet.success) throw new Error(providerSet.error || 'Failed to set transcription provider.');

            setHasStoredDeepgramKey(true);
            setDeepgramStatus('success');
            setDeepgramMessage('Transcription saved.');
        } catch (error: any) {
            setDeepgramStatus('error');
            setDeepgramMessage(error?.message || 'Failed to save Deepgram.');
        }
    };

    const testDeepgram = async () => {
        setDeepgramStatus('testing');
        setDeepgramMessage(null);

        try {
            const key = deepgramApiKey.trim();
            if (!key && !hasStoredDeepgramKey) throw new Error('Paste your Deepgram key first.');

            setDeepgramMessage('Recording 3 seconds...');
            const sample = await recordMicrophoneSample();
            setDeepgramMessage('Testing Deepgram...');

            const result = await window.electronAPI?.testDeepgramTranscription?.(key, sample.audioBase64, sample.mimeType);
            if (!result?.success) throw new Error(result?.error || 'Deepgram test failed.');

            await window.electronAPI?.setSttProvider?.('deepgram');
            setDeepgramStatus('success');
            setDeepgramMessage(result.transcript ? `Transcribed: "${result.transcript}"` : 'Transcription works.');
        } catch (error: any) {
            setDeepgramStatus('error');
            setDeepgramMessage(error?.message || 'Deepgram test failed.');
        }
    };

    return (
        <div className="space-y-3 animated fadeIn pb-8">
            <ProviderCard
                title="Text AI"
                badge="Gemini 2.5 Flash"
                ready={textProviderReady}
                readyLabel={textProviderReady ? 'Saved' : 'Needs key'}
                keyUrl={OPENROUTER_KEYS_URL}
                keyButton="OpenRouter key"
                value={openRouterApiKey}
                placeholder={hasStoredOpenRouterKey ? '************' : 'sk-or-v1-...'}
                onChange={(value) => {
                    setOpenRouterApiKey(value);
                    setOpenRouterStatus('idle');
                    setOpenRouterMessage(null);
                }}
                onSave={saveOpenRouter}
                onTest={testOpenRouter}
                saveDisabled={openRouterStatus === 'saving' || !openRouterApiKey.trim()}
                testDisabled={openRouterStatus === 'testing' || !hasStoredOpenRouterKey}
                busyLabel={openRouterStatus === 'saving' ? 'Saving...' : openRouterStatus === 'testing' ? 'Testing...' : null}
                message={openRouterMessage}
                isError={openRouterStatus === 'error'}
                secondaryLink={{ label: 'Credits', url: OPENROUTER_CREDITS_URL }}
            />

            <ProviderCard
                title="Transcription"
                badge="Deepgram Flux"
                ready={transcriptionReady}
                readyLabel={transcriptionReady ? 'Saved' : 'Needs key'}
                keyUrl={DEEPGRAM_KEYS_URL}
                keyButton="Deepgram key"
                value={deepgramApiKey}
                placeholder={hasStoredDeepgramKey ? '************' : 'Deepgram API key'}
                onChange={(value) => {
                    setDeepgramApiKey(value);
                    setDeepgramStatus('idle');
                    setDeepgramMessage(null);
                }}
                onSave={saveDeepgram}
                onTest={testDeepgram}
                saveDisabled={deepgramStatus === 'saving' || !deepgramApiKey.trim()}
                testDisabled={deepgramStatus === 'testing' || (!hasStoredDeepgramKey && !deepgramApiKey.trim())}
                busyLabel={deepgramStatus === 'saving' ? 'Saving...' : deepgramStatus === 'testing' ? 'Testing...' : null}
                message={deepgramMessage}
                isError={deepgramStatus === 'error'}
            />
        </div>
    );
};

interface ProviderCardProps {
    title: string;
    badge: string;
    ready: boolean;
    readyLabel: string;
    keyUrl: string;
    keyButton: string;
    value: string;
    placeholder: string;
    onChange: (value: string) => void;
    onSave: () => void;
    onTest: () => void;
    saveDisabled: boolean;
    testDisabled: boolean;
    busyLabel: string | null;
    message: string | null;
    isError: boolean;
    secondaryLink?: { label: string; url: string };
}

const ProviderCard: React.FC<ProviderCardProps> = ({
    title,
    badge,
    ready,
    readyLabel,
    keyUrl,
    keyButton,
    value,
    placeholder,
    onChange,
    onSave,
    onTest,
    saveDisabled,
    testDisabled,
    busyLabel,
    message,
    isError,
    secondaryLink,
}) => {
    const isBusy = Boolean(busyLabel);

    return (
        <div className="bg-bg-item-surface rounded-xl p-4 border border-border-subtle space-y-3">
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                    <h3 className="text-sm font-bold text-text-primary whitespace-nowrap">{title}</h3>
                    <span className="px-2 py-0.5 rounded-full text-[9px] font-semibold bg-bg-input text-text-secondary border border-border-subtle truncate">
                        {badge}
                    </span>
                </div>
                <StatusPill ready={ready} label={readyLabel} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[150px_1fr_auto_auto] gap-2 items-center">
                <button
                    type="button"
                    onClick={() => window.electronAPI?.openExternal?.(keyUrl)}
                    className="px-3 py-2 rounded-lg bg-bg-input hover:bg-bg-elevated border border-border-subtle text-xs font-semibold text-text-primary flex items-center justify-center gap-2 transition-colors"
                >
                    {keyButton} <ExternalLink size={12} />
                </button>

                <input
                    type="password"
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    placeholder={placeholder}
                    className="w-full min-w-0 bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent-primary transition-colors"
                />

                <button
                    type="button"
                    onClick={onSave}
                    disabled={saveDisabled || isBusy}
                    className="px-4 py-2 rounded-lg bg-bg-input hover:bg-bg-elevated border border-border-subtle text-xs font-semibold text-text-primary disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
                >
                    {isBusy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                    {busyLabel || 'Save'}
                </button>

                <button
                    type="button"
                    onClick={onTest}
                    disabled={testDisabled || isBusy}
                    className="px-4 py-2 rounded-lg bg-white text-black hover:bg-gray-200 text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
                >
                    <Check size={13} />
                    Test
                </button>
            </div>

            {(message || secondaryLink) && (
                <div className="flex items-center justify-between gap-3 min-h-4">
                    {message ? (
                        <div className={`text-xs flex items-center gap-2 ${isError ? 'text-red-400' : 'text-green-400'}`}>
                            {isError ? <AlertCircle size={13} /> : <CheckCircle size={13} />}
                            <span>{message}</span>
                        </div>
                    ) : <span />}

                    {secondaryLink && (
                        <button
                            type="button"
                            onClick={() => window.electronAPI?.openExternal?.(secondaryLink.url)}
                            className="text-xs text-text-tertiary hover:text-text-primary transition-colors whitespace-nowrap"
                        >
                            {secondaryLink.label}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};
