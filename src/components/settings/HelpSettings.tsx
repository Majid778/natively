import React from 'react';
import { ExternalLink, KeyRound, Mic, Monitor, PackageCheck, ShieldCheck, Wrench } from 'lucide-react';

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
          <h2 className="text-2xl font-bold tracking-tight">Setup & Help</h2>
          <p className="text-sm text-text-secondary mt-1">
            Quick setup for the open-source local build. No hosted paid backend, subscriptions, or quotas.
          </p>
        </div>

        <section className="rounded-2xl border border-border-subtle bg-bg-card p-5 space-y-4">
          <Step n={1} title="Add your OpenRouter key">
            Create a key, paste it in AI Providers, verify it, and keep Gemini 2.5 Flash as the default unless you want to experiment.
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
            Create a Deepgram API key, paste it in AI Providers, save it, then run the 3-second transcription test. Deepgram Flux is the default cloud transcription path.
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

          <Step n={3} title="Start and stop a meeting">
            Press Start Natively from the launcher. The AI panel appears only after meeting start. Press the stop button on the AI panel to end capture, generate the meeting summary, and return to the launcher.
          </Step>
        </section>

        <div className="grid md:grid-cols-2 gap-4">
          <Card title="Packaging" icon={<PackageCheck size={16} />}>
            <p>Installers are built per platform:</p>
            <pre className="rounded-lg bg-bg-input border border-border-subtle p-3 text-[11px] text-text-primary overflow-x-auto">npm run dist:win   # Windows .exe
npm run dist:mac   # macOS .dmg</pre>
            <p>Unsigned builds may warn: Windows SmartScreen (More info → Run anyway) or macOS Gatekeeper (right-click → Open).</p>
          </Card>

          <Card title="Microphone & System Audio" icon={<Mic size={16} />}>
            <p><strong className="text-text-primary">Your voice</strong> needs microphone access.</p>
            <p><strong className="text-text-primary">The other person</strong> is captured from system audio, which on macOS needs <strong className="text-text-primary">Screen Recording</strong> permission. The mic works without it — so if you're transcribed but they aren't, grant Screen Recording in System Settings → Privacy &amp; Security, then restart the app.</p>
            <p>Also make sure the call's audio is playing through your selected output device.</p>
          </Card>

          <Card title="Model Modes" icon={<KeyRound size={16} />}>
            <p>Use Manage Modes to create reusable prompts for interviews, study calls, meetings, or sales calls.</p>
            <p>The active mode is included in AI panel requests.</p>
          </Card>

          <Card title="Privacy" icon={<ShieldCheck size={16} />}>
            <p>Meeting data and settings are local. AI text is sent only to the provider you configure.</p>
            <p>This fork should not include analytics or a paid backend.</p>
          </Card>
        </div>

        <Card title="Troubleshooting" icon={<Wrench size={16} />}>
          <ul className="list-disc pl-5 space-y-1">
            <li>Hearing yourself but not the other person? Grant macOS Screen Recording (see above) and restart — that's what captures system audio.</li>
            <li>If transcription stays empty, re-open AI Providers, re-save your Deepgram key, and run the transcription test.</li>
            <li>If AI responses fail, re-open AI Providers and check your OpenRouter key.</li>
            <li>If the app opens straight into a meeting, stop it and restart the app.</li>
            <li>If native audio is unavailable, quit the app and run <code className="px-1 py-0.5 rounded bg-bg-input">npm run build:native</code>.</li>
          </ul>
        </Card>

        <div className="rounded-2xl border border-border-subtle bg-bg-card p-4 flex items-start gap-3">
          <Monitor size={18} className="text-text-secondary mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-text-primary">Install on another computer</h3>
            <p className="text-xs text-text-secondary mt-1 leading-relaxed">
              Tell Claude: "Install Natively OSS from this GitHub repo. Download the right build for my OS from the latest Release — the Windows installer or the macOS .dmg for my chip. After launch, help me add my OpenRouter and Deepgram keys in Settings &gt; AI Providers."
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
