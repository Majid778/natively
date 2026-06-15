/**
 * DeepgramStreamingSTT - WebSocket-based streaming Speech-to-Text using Deepgram Flux
 *
 * Implements the same EventEmitter interface as GoogleSTT:
 *   Events: 'transcript' ({ text, isFinal, confidence }), 'error' (Error)
 *   Methods: start(), stop(), write(chunk), setSampleRate(), setAudioChannelCount()
 *
 * Sends raw PCM (linear16, 16-bit LE) over WebSocket — NO WAV header.
 * Receives interim and final transcription results in real time.
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { RECOGNITION_LANGUAGES } from '../config/languages';

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;
const RECONNECT_MAX_ATTEMPTS = 10;
const DEEPGRAM_FLUX_MODEL = process.env.DEEPGRAM_STT_MODEL?.trim() || 'flux-general-en';

export class DeepgramStreamingSTT extends EventEmitter {
    private apiKey: string;
    private ws: WebSocket | null = null;
    private isActive = false;
    private shouldReconnect = false;

    private sampleRate = 16000;
    private socketSampleRate: number | null = null;
    private numChannels = 1;
    private languageCode = 'en'; // Default to English

    private reconnectAttempts = 0;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private keepAliveTimer: NodeJS.Timeout | null = null;
    private restartTimer: NodeJS.Timeout | null = null;
    private buffer: Buffer[] = [];
    private isConnecting = false;

    constructor(apiKey: string) {
        super();
        this.apiKey = apiKey;
    }

    // =========================================================================
    // Configuration (match GoogleSTT / RestSTT interface)
    // =========================================================================

    public setSampleRate(rate: number): void {
        if (this.sampleRate === rate) return;
        this.sampleRate = rate;
        console.log(`[DeepgramStreaming] Sample rate set to ${rate}`);

        if (this.isActive) {
            // The device's real sample rate often arrives ~1s after capture starts
            // (an initial guess of 48000, corrected to e.g. 44100). Deepgram needs the
            // rate in the connection URL, so a change requires a fresh socket — but a
            // synchronous stop()+start() races the in-flight handshake and throws
            // "WebSocket was closed before the connection was established", leaving the
            // stream in a reconnect storm that never delivers transcripts. Debounce the
            // change and reconnect race-safely instead.
            this.scheduleRestart();
        }
    }

    public setAudioChannelCount(count: number): void {
        this.numChannels = count;
        console.log(`[DeepgramStreaming] Channel count set to ${count}`);
    }

    /** Set recognition language using ISO-639-1 code */
    public setRecognitionLanguage(key: string): void {
        const config = RECOGNITION_LANGUAGES[key];
        if (config) {
            this.languageCode = config.iso639;
            console.log(`[DeepgramStreaming] Language set to ${this.languageCode}`);

            if (this.isActive) {
                console.log('[DeepgramStreaming] Language changed while active. Restarting...');
                this.scheduleRestart();
            }
        }
    }

    /** No-op — no Google credentials needed */
    public setCredentials(_path: string): void { }

    // =========================================================================
    // Lifecycle
    // =========================================================================

    public start(): void {
        if (this.isActive) return;
        // Mark active immediately so write() buffers chunks
        // instead of dropping them during WebSocket handshake (~500ms).
        this.isActive = true;
        this.shouldReconnect = true;
        this.reconnectAttempts = 0;
        this.connect();
    }

    public stop(): void {
        this.shouldReconnect = false;
        this.clearTimers();
        this.teardownSocket();
        this.isActive = false;
        this.buffer = [];
        console.log('[DeepgramStreaming] Stopped');
    }

    /**
     * Close and discard the current socket without throwing or arming the
     * auto-reconnect path. Safe to call while the socket is still CONNECTING:
     * detaching listeners first prevents the ws library's
     * "WebSocket was closed before the connection was established" error, and
     * terminate() kills a half-open handshake cleanly. Does NOT clear the audio
     * buffer, so buffered chunks survive into the next connection.
     */
    private teardownSocket(): void {
        this.clearKeepAlive();
        const ws = this.ws;
        this.ws = null;
        this.socketSampleRate = null;
        this.isConnecting = false;
        if (!ws) return;
        ws.removeAllListeners();
        ws.on('error', () => { /* swallow late errors from the discarded socket */ });
        try {
            if (ws.readyState === WebSocket.OPEN) {
                try { ws.send(JSON.stringify({ type: 'CloseStream' })); } catch { /* ignore */ }
                ws.close();
            } else {
                // CONNECTING or CLOSING — calling close() now would throw; kill quietly.
                ws.terminate();
            }
        } catch { /* ignore */ }
    }

    /**
     * Coalesce rapid config changes (e.g. the initial sample-rate correction)
     * into a single clean reconnect shortly after the last change, instead of
     * restarting the socket synchronously mid-handshake.
     */
    private scheduleRestart(): void {
        if (this.restartTimer) clearTimeout(this.restartTimer);
        this.restartTimer = setTimeout(() => {
            this.restartTimer = null;
            if (!this.isActive) return;
            this.teardownSocket();
            if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
            this.reconnectAttempts = 0;
            this.connect();
        }, 300);
    }

    // =========================================================================
    // Audio Data
    // =========================================================================

    public write(chunk: Buffer): void {
        if (!this.isActive) return;

        if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.socketSampleRate !== this.sampleRate) {
            this.buffer.push(chunk);
            if (this.buffer.length > 500) this.buffer.shift(); // Cap buffer size
            
            if (!this.isConnecting && this.shouldReconnect && !this.reconnectTimer && !this.restartTimer) {
                console.log('[DeepgramStreaming] WS not ready. Lazy connecting on new audio...');
                this.connect();
            }
            return;
        }

        this.ws.send(chunk);
    }

    // =========================================================================
    // WebSocket Connection
    // =========================================================================

    private connect(): void {
        if (this.isConnecting) return;
        this.isConnecting = true;
        const connectionSampleRate = this.sampleRate;

        const url =
            `wss://api.deepgram.com/v2/listen` +
            `?model=${encodeURIComponent(DEEPGRAM_FLUX_MODEL)}` +
            `&encoding=linear16` +
            `&sample_rate=${connectionSampleRate}`;

        console.log(`[DeepgramStreaming] Connecting (rate=${connectionSampleRate}, ch=${this.numChannels})...`);

        this.ws = new WebSocket(url, {
            headers: {
                Authorization: `Token ${this.apiKey}`,
            },
        });
        this.socketSampleRate = connectionSampleRate;

        this.ws.on('open', () => {
            this.isActive = true;
            this.isConnecting = false;
            this.reconnectAttempts = 0;
            console.log('[DeepgramStreaming] Connected');

            if (this.socketSampleRate !== this.sampleRate) {
                console.log('[DeepgramStreaming] Connected socket has stale sample rate; buffering until restart');
                return;
            }

            // Send buffered audio
            while (this.buffer.length > 0) {
                const chunk = this.buffer.shift();
                if (chunk && this.ws?.readyState === WebSocket.OPEN) {
                    this.ws.send(chunk);
                }
            }

            // NOTE: Do NOT send a keep-alive message. Deepgram Flux (v2/listen) only
            // accepts `CloseStream` or `Configure` as text frames; it rejects
            // `{type:"KeepAlive"}` with UNPARSABLE_CLIENT_MESSAGE and immediately
            // closes the socket. That killed every transcription session ~5s in
            // (verified against the live API). The continuous meeting audio keeps the
            // stream alive; gaps are handled by reconnect-on-next-audio in write().
        });

        this.ws.on('message', (data: WebSocket.Data) => {
            try {
                const msg = JSON.parse(data.toString());

                // Flux v2 response structure:
                // { type: "TurnInfo", event: "Update|EndOfTurn|...", transcript, words, end_of_turn_confidence }
                if (msg.type === 'TurnInfo') {
                    const transcript = msg.transcript;
                    if (!transcript) return;

                    this.emit('transcript', {
                        text: transcript,
                        isFinal: msg.event === 'EndOfTurn',
                        confidence: msg.end_of_turn_confidence ?? 1.0,
                    });
                    return;
                }

                // Legacy v1/Nova response support, kept as a harmless fallback.
                if (msg.type !== 'Results') return;

                const transcript = msg.channel?.alternatives?.[0]?.transcript;
                if (!transcript) return;

                this.emit('transcript', {
                    text: transcript,
                    isFinal: msg.is_final ?? false,
                    confidence: msg.channel?.alternatives?.[0]?.confidence ?? 1.0,
                });
            } catch (err) {
                console.error('[DeepgramStreaming] Parse error:', err);
            }
        });

        this.ws.on('error', (err: Error) => {
            console.error('[DeepgramStreaming] WebSocket error:', err.message);
            this.emit('error', err);
        });

        this.ws.on('close', (code: number, reason: Buffer) => {
            // Do not force isActive=false; let write() trigger reconnect if isActive is still true
            this.isConnecting = false;
            this.clearKeepAlive();
            console.log(`[DeepgramStreaming] Closed (code=${code}, reason=${reason.toString()})`);

            // Auto-reconnect on unexpected close (excluding silence timeout 1000)
            if (this.shouldReconnect && code !== 1000) {
                this.scheduleReconnect();
            }
        });
    }

    // =========================================================================
    // Reconnection
    // =========================================================================

    private scheduleReconnect(): void {
        if (!this.shouldReconnect) return;

        if (this.reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
            console.error(`[DeepgramStreaming] Max reconnect attempts (${RECONNECT_MAX_ATTEMPTS}) reached — giving up`);
            this.emit('error', new Error('DeepgramStreamingSTT: max reconnect attempts exceeded'));
            return;
        }

        const delay = Math.min(
            RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts),
            RECONNECT_MAX_DELAY_MS
        );
        this.reconnectAttempts++;

        console.log(`[DeepgramStreaming] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${RECONNECT_MAX_ATTEMPTS})...`);

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (this.shouldReconnect) {
                this.connect();
            }
        }, delay);
    }

    // =========================================================================
    // Keep-alive
    // =========================================================================
    // Flux has no client keep-alive (it rejects {type:"KeepAlive"}); the audio
    // stream itself keeps the socket alive. clearKeepAlive() is retained as a
    // harmless no-op for the legacy timer field so existing call sites are safe.

    private clearKeepAlive(): void {
        if (this.keepAliveTimer) {
            clearInterval(this.keepAliveTimer);
            this.keepAliveTimer = null;
        }
    }

    private clearTimers(): void {
        this.clearKeepAlive();
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = null;
        }
    }
}
