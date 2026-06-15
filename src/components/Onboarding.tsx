import React, { useCallback, useEffect, useState } from 'react';
import {
  Sparkles, Mic, Monitor, Check, ChevronRight, ChevronLeft, ExternalLink,
  ShieldCheck, MessageSquare, Play, SlidersHorizontal, Square, Loader2, KeyRound,
} from 'lucide-react';
import { saveOpenRouterKey, saveDeepgramKey } from '../lib/providerSetup';

type PermStatus = 'granted' | 'denied' | 'not-determined' | 'restricted' | string;

interface OnboardingProps {
  onComplete: () => void;
}

const TOTAL_STEPS = 6;

const Header: React.FC<{ icon: React.ReactNode; title: string; subtitle?: string }> = ({ icon, title, subtitle }) => (
  <div className="flex flex-col items-center text-center mb-7">
    <div className="w-14 h-14 rounded-2xl bg-bg-item-surface border border-border-subtle flex items-center justify-center mb-4 text-accent-primary">
      {icon}
    </div>
    <h1 className="text-2xl font-bold text-text-primary">{title}</h1>
    {subtitle && <p className="text-base text-text-secondary mt-2 leading-relaxed">{subtitle}</p>}
  </div>
);

const KeyConnect: React.FC<{
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  connected: boolean;
  busy: boolean;
  error: string;
  getKeyUrl: string;
  onGetKey: (url: string) => void;
  onConnect: () => void;
}> = ({ placeholder, value, onChange, connected, busy, error, getKeyUrl, onGetKey, onConnect }) => (
  <div className="space-y-2.5">
    {connected ? (
      <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3.5 py-3 text-sm text-emerald-400 font-medium">
        <Check size={16} /> Connected
      </div>
    ) : (
      <>
        <div className="flex gap-2">
          <input
            type="password"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && value.trim() && !busy) onConnect(); }}
            placeholder={placeholder}
            spellCheck={false}
            className="flex-1 min-w-0 h-10 rounded-lg border border-border-subtle bg-bg-input px-3 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent-primary/50"
          />
          <button
            onClick={onConnect}
            disabled={busy || !value.trim()}
            className={`px-4 h-10 rounded-lg text-sm font-semibold inline-flex items-center justify-center gap-1.5 shrink-0 transition-opacity ${
              busy || !value.trim() ? 'bg-bg-input text-text-tertiary border border-border-subtle cursor-not-allowed' : 'bg-text-primary text-bg-main hover:opacity-90'
            }`}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : null}
            {busy ? 'Connecting' : 'Connect'}
          </button>
        </div>
        {error
          ? <p className="text-[11px] text-red-500">{error}</p>
          : <button onClick={() => onGetKey(getKeyUrl)} className="text-[11px] text-text-tertiary hover:text-text-primary inline-flex items-center gap-1 transition-colors">Get a key <ExternalLink size={11} /></button>}
      </>
    )}
  </div>
);

const PermRow: React.FC<{
  icon: React.ReactNode; title: string; desc: string; status: PermStatus; busy: boolean; onGrant: () => void;
}> = ({ icon, title, desc, status, busy, onGrant }) => {
  const granted = status === 'granted';
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border-subtle bg-bg-card p-3.5">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 border transition-colors ${granted ? 'border-emerald-500/40 text-emerald-400' : 'border-border-subtle text-text-secondary'}`}>{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-text-primary">{title}</div>
        <div className="text-xs text-text-secondary mt-0.5 leading-relaxed">{desc}</div>
      </div>
      {granted ? (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400 shrink-0"><Check size={14} /> Granted</span>
      ) : (
        <button onClick={onGrant} disabled={busy} className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-text-primary text-bg-main hover:opacity-90 transition-opacity shrink-0 disabled:opacity-50">
          {busy ? 'Opening…' : status === 'denied' ? 'Open Settings' : 'Allow'}
        </button>
      )}
    </div>
  );
};

const UsePoint: React.FC<{ icon: React.ReactNode; title: string; desc: string }> = ({ icon, title, desc }) => (
  <div className="flex gap-3">
    <div className="w-9 h-9 rounded-lg bg-bg-item-surface border border-border-subtle flex items-center justify-center text-accent-primary shrink-0">{icon}</div>
    <div>
      <div className="text-sm font-semibold text-text-primary">{title}</div>
      <div className="text-xs text-text-secondary mt-0.5 leading-relaxed">{desc}</div>
    </div>
  </div>
);

const RecapRow: React.FC<{ label: string; done: boolean }> = ({ label, done }) => (
  <div className="flex items-center justify-between rounded-lg border border-border-subtle bg-bg-card px-3.5 py-2.5">
    <span className="text-sm text-text-primary">{label}</span>
    {done
      ? <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400"><Check size={14} /> Ready</span>
      : <span className="text-xs text-text-tertiary">Not set</span>}
  </div>
);

const Onboarding: React.FC<OnboardingProps> = ({ onComplete }) => {
  const [step, setStep] = useState(0);

  const [orKey, setOrKey] = useState('');
  const [orConnected, setOrConnected] = useState(false);
  const [orBusy, setOrBusy] = useState(false);
  const [orError, setOrError] = useState('');

  const [dgKey, setDgKey] = useState('');
  const [dgConnected, setDgConnected] = useState(false);
  const [dgBusy, setDgBusy] = useState(false);
  const [dgError, setDgError] = useState('');

  const [mic, setMic] = useState<PermStatus>('not-determined');
  const [screen, setScreen] = useState<PermStatus>('not-determined');
  const [permBusy, setPermBusy] = useState<'mic' | 'screen' | null>(null);

  // Reflect any keys already saved (e.g. re-running onboarding).
  useEffect(() => {
    (async () => {
      try {
        const creds = await window.electronAPI?.getStoredCredentials?.();
        if (creds) {
          setOrConnected(Boolean(creds.hasOpenRouterKey || creds.openRouterApiKey));
          setDgConnected(Boolean(creds.hasDeepgramKey || creds.sttDeepgramKey));
        }
      } catch { /* ignore */ }
    })();
  }, []);

  const refreshPerms = useCallback(async () => {
    try {
      const s = await window.electronAPI?.getPermissionsStatus?.();
      if (s) { setMic(s.microphone); setScreen(s.screenRecording); }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    refreshPerms();
    const interval = window.setInterval(refreshPerms, 1500);
    const onFocus = () => refreshPerms();
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(interval); window.removeEventListener('focus', onFocus); };
  }, [refreshPerms]);

  const openExternal = (url: string) => window.electronAPI?.openExternal?.(url);

  const connectOpenRouter = async () => {
    setOrBusy(true); setOrError('');
    const r = await saveOpenRouterKey(orKey);
    if (r.success) { setOrConnected(true); setOrKey(''); } else setOrError(r.error || 'Could not connect.');
    setOrBusy(false);
  };
  const connectDeepgram = async () => {
    setDgBusy(true); setDgError('');
    const r = await saveDeepgramKey(dgKey);
    if (r.success) { setDgConnected(true); setDgKey(''); } else setDgError(r.error || 'Could not connect.');
    setDgBusy(false);
  };

  const grantMic = async () => {
    setPermBusy('mic');
    try {
      if (mic === 'denied') await window.electronAPI?.openMicrophoneSettings?.();
      else await window.electronAPI?.requestMicrophonePermission?.();
    } finally { setPermBusy(null); refreshPerms(); }
  };
  const grantScreen = async () => {
    setPermBusy('screen');
    try { await window.electronAPI?.requestScreenRecordingPermission?.(); }
    finally { setPermBusy(null); refreshPerms(); }
  };

  const next = () => setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));
  const isLast = step === TOTAL_STEPS - 1;

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <div className="pt-6">
            <Header
              icon={<Sparkles size={22} />}
              title="Welcome to Natively"
              subtitle="Natively listens to your calls and suggests what to say, in real time. Let's get you set up. It takes about two minutes."
            />
          </div>
        );
      case 1:
        return (
          <>
            <Header icon={<KeyRound size={22} />} title="Connect AI responses" subtitle="Natively uses OpenRouter to generate your responses. Paste a key to connect it." />
            <KeyConnect
              placeholder="sk-or-v1-..."
              value={orKey} onChange={(v) => { setOrKey(v); setOrError(''); }}
              connected={orConnected} busy={orBusy} error={orError}
              getKeyUrl="https://openrouter.ai/keys" onGetKey={openExternal} onConnect={connectOpenRouter}
            />
            <p className="text-[11px] text-text-tertiary mt-3">You can also add or change this later in Settings, under AI Providers.</p>
          </>
        );
      case 2:
        return (
          <>
            <Header icon={<MessageSquare size={22} />} title="Connect transcription" subtitle="Deepgram turns speech into text so Natively can follow the conversation. Paste a key to connect it." />
            <KeyConnect
              placeholder="Deepgram API key"
              value={dgKey} onChange={(v) => { setDgKey(v); setDgError(''); }}
              connected={dgConnected} busy={dgBusy} error={dgError}
              getKeyUrl="https://console.deepgram.com/project/keys" onGetKey={openExternal} onConnect={connectDeepgram}
            />
            <p className="text-[11px] text-text-tertiary mt-3">You can run a full transcription test later in Settings, under AI Providers.</p>
          </>
        );
      case 3:
        return (
          <>
            <Header icon={<ShieldCheck size={22} />} title="Grant permissions" subtitle="Natively needs two permissions to transcribe a call. You can change them later in System Settings." />
            <div className="space-y-2.5">
              <PermRow icon={<Mic size={18} />} title="Microphone" desc="So Natively can hear you." status={mic} busy={permBusy === 'mic'} onGrant={grantMic} />
              <PermRow icon={<Monitor size={18} />} title="Screen Recording" desc="So Natively can hear the other person on the call." status={screen} busy={permBusy === 'screen'} onGrant={grantScreen} />
            </div>
            <p className="text-[11px] text-text-tertiary mt-3 text-center leading-relaxed">Screen Recording may need you to restart Natively before it takes effect.</p>
          </>
        );
      case 4:
        return (
          <>
            <Header icon={<Play size={20} />} title="How to use Natively" subtitle="Here is the whole flow." />
            <div className="space-y-4">
              <UsePoint icon={<Play size={16} />} title="Start a meeting" desc="Press Start Natively on the launcher. The assistant panel opens once the meeting begins." />
              <UsePoint icon={<MessageSquare size={16} />} title="Get live suggestions" desc="Natively transcribes you and the other person, and suggests responses you can read or adapt on the spot." />
              <UsePoint icon={<SlidersHorizontal size={16} />} title="Pick a mode" desc="Use Manage Modes to tailor responses for the kind of call, such as an interview or a sales call." />
              <UsePoint icon={<Square size={16} />} title="Stop to wrap up" desc="Press stop to end the meeting and save its summary." />
            </div>
          </>
        );
      case 5:
      default:
        return (
          <>
            <Header icon={<Check size={22} />} title="You're all set" subtitle="Here is where things stand. You can finish anything that is still missing from Settings." />
            <div className="space-y-2">
              <RecapRow label="AI responses" done={orConnected} />
              <RecapRow label="Transcription" done={dgConnected} />
              <RecapRow label="Microphone" done={mic === 'granted'} />
              <RecapRow label="Screen Recording" done={screen === 'granted'} />
            </div>
          </>
        );
    }
  };

  return (
    <div className="h-full w-full flex flex-col bg-[#000000] text-text-primary">
      <div className="flex items-center justify-center gap-1.5 pt-6 shrink-0">
        {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
          <div key={i} className={`h-1 rounded-full transition-all duration-300 ${i === step ? 'w-6 bg-accent-primary' : i < step ? 'w-3 bg-accent-primary/50' : 'w-3 bg-bg-item-surface'}`} />
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-6 py-4 flex items-center justify-center">
        <div className="w-full max-w-lg">{renderStep()}</div>
      </div>

      <div className="px-6 pb-6 pt-2 shrink-0">
        <div className="w-full max-w-lg mx-auto flex items-center gap-2">
          {step > 0 && (
            <button onClick={back} className="px-3 py-2.5 rounded-xl text-sm font-medium text-text-secondary hover:text-text-primary inline-flex items-center gap-1 transition-colors">
              <ChevronLeft size={16} /> Back
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={isLast ? onComplete : next}
            className="px-6 py-2.5 rounded-xl text-sm font-semibold bg-accent-primary text-white hover:opacity-90 inline-flex items-center gap-1.5 transition-opacity"
          >
            {step === 0 ? 'Get started' : isLast ? 'Finish' : 'Continue'}
            {!isLast && <ChevronRight size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Onboarding;
