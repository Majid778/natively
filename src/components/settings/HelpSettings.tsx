import React from 'react';
import { ExternalLink, Mic, ShieldCheck, SlidersHorizontal, Wrench } from 'lucide-react';

interface HelpSettingsProps {
  onNavigate?: (tab: string) => void;
}

const Card: React.FC<{ title: string; children: React.ReactNode; icon: React.ReactNode }> = ({ title, children, icon }) => (
  <section className="rounded-2xl border border-border-subtle bg-bg-card p-4">
    <div className="flex items-center gap-2 mb-2">
      <div className="w-8 h-8 rounded-lg bg-bg-item-surface border border-border-subtle flex items-center justify-center text-text-secondary">
        {icon}
      </div>
      <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
    </div>
    <div className="text-xs leading-relaxed text-text-secondary space-y-2">{children}</div>
  </section>
);

const Step: React.FC<{ n: number; title: string; children: React.ReactNode }> = ({ n, title, children }) => (
  <div className="flex gap-3">
    <div className="mt-0.5 w-6 h-6 rounded-full bg-bg-item-surface border border-border-subtle flex items-center justify-center text-[11px] font-bold text-text-primary shrink-0">
      {n}
    </div>
    <div>
      <div className="text-sm font-semibold text-text-primary">{title}</div>
      <div className="text-xs text-text-secondary leading-relaxed mt-1">{children}</div>
    </div>
  </div>
);

export const HelpSettings: React.FC<HelpSettingsProps> = ({ onNavigate }) => {
  const openExternal = (url: string) => {
    window.electronAPI?.openExternal?.(url);
  };

  return (
    <div className="h-full overflow-y-auto px-7 py-7 text-text-primary">
      <div className="max-w-3xl mx-auto space-y-5">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Setup &amp; Help</h2>
          <p className="text-sm text-text-secondary mt-1">
            Add your keys, grant permissions, and start your first meeting.
          </p>
        </div>

        <section className="rounded-2xl border border-border-subtle bg-bg-card p-5 space-y-4">
          <Step n={1} title="Add your OpenRouter key">
            Natively uses OpenRouter for its responses. Create a key, add it under AI Providers, and verify it.
            <div className="flex flex-wrap gap-2 mt-3">
              <button
                onClick={() => openExternal('https://openrouter.ai/keys')}
                className="px-3 py-2 rounded-lg bg-bg-input border border-border-subtle hover:bg-bg-item-hover text-text-primary inline-flex items-center gap-2 transition-colors"
              >
                Get OpenRouter key <ExternalLink size={13} />
              </button>
              <button
                onClick={() => onNavigate?.('ai-providers')}
                className="px-3 py-2 rounded-lg bg-text-primary text-bg-main hover:opacity-90 inline-flex items-center gap-2 transition-opacity"
              >
                Open AI Providers
              </button>
            </div>
          </Step>

          <Step n={2} title="Add your Deepgram key">
            Deepgram handles transcription. Create a key, add it under AI Providers, then run the transcription test to confirm it works.
            <div className="flex flex-wrap gap-2 mt-3">
              <button
                onClick={() => openExternal('https://console.deepgram.com/project/keys')}
                className="px-3 py-2 rounded-lg bg-bg-input border border-border-subtle hover:bg-bg-item-hover text-text-primary inline-flex items-center gap-2 transition-colors"
              >
                Get Deepgram key <ExternalLink size={13} />
              </button>
              <button
                onClick={() => onNavigate?.('ai-providers')}
                className="px-3 py-2 rounded-lg bg-text-primary text-bg-main hover:opacity-90 inline-flex items-center gap-2 transition-opacity"
              >
                Open AI Providers
              </button>
            </div>
          </Step>

          <Step n={3} title="Grant permissions">
            Natively needs your microphone to hear you, and Screen Recording to hear the other person on the call. Grant both in System Settings, then restart Natively.
            <div className="flex flex-wrap gap-2 mt-3">
              <button
                onClick={() => window.electronAPI?.openMicrophoneSettings?.()}
                className="px-3 py-2 rounded-lg bg-bg-input border border-border-subtle hover:bg-bg-item-hover text-text-primary inline-flex items-center gap-2 transition-colors"
              >
                Microphone settings <ExternalLink size={13} />
              </button>
              <button
                onClick={() => window.electronAPI?.openScreenRecordingSettings?.()}
                className="px-3 py-2 rounded-lg bg-bg-input border border-border-subtle hover:bg-bg-item-hover text-text-primary inline-flex items-center gap-2 transition-colors"
              >
                Screen Recording settings <ExternalLink size={13} />
              </button>
            </div>
          </Step>

          <Step n={4} title="Start a meeting">
            Press Start Natively. The assistant panel opens once the meeting begins. Press stop to end the meeting and save its summary.
          </Step>
        </section>

        <div className="grid grid-cols-1 gap-4">
          <Card title="Microphone and system audio" icon={<Mic size={16} />}>
            <p>Your microphone captures your voice. System audio captures the other person, and on macOS that needs Screen Recording permission.</p>
            <p>Your microphone works on its own, so if your words are transcribed but theirs are not, grant Screen Recording and restart Natively.</p>
            <p>Also confirm the call audio is playing through your selected output device.</p>
          </Card>

          <Card title="Modes" icon={<SlidersHorizontal size={16} />}>
            <p>Create reusable instructions for different kinds of calls in Manage Modes, such as interviews, meetings, or sales calls.</p>
            <p>The active mode shapes every response Natively suggests.</p>
          </Card>

          <Card title="Privacy" icon={<ShieldCheck size={16} />}>
            <p>Your meetings and settings stay on this device.</p>
            <p>Text is sent only to the AI provider you set up.</p>
          </Card>
        </div>

        <Card title="Troubleshooting" icon={<Wrench size={16} />}>
          <ul className="list-disc pl-5 space-y-1">
            <li>If you are transcribed but the other person is not, grant Screen Recording permission and restart Natively.</li>
            <li>If transcription stays empty, open AI Providers, save your Deepgram key again, and run the test.</li>
            <li>If responses fail, open AI Providers and check your OpenRouter key.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
};
