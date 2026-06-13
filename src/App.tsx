import React, { useState, useEffect } from "react" // forcing refresh
import { QueryClient, QueryClientProvider } from "react-query"
import { ToastProvider, ToastViewport } from "./components/ui/toast"
import NativelyInterface from "./components/NativelyInterface"
import SettingsPopup from "./components/SettingsPopup"
import Launcher from "./components/Launcher"
import ModelSelectorWindow from "./components/ModelSelectorWindow"
import SettingsOverlay from "./components/SettingsOverlay"
import StartupSequence from "./components/StartupSequence"
import Onboarding from "./components/Onboarding"
import { AnimatePresence, motion } from "framer-motion"
import UpdateBanner from "./components/UpdateBanner"
import { AlertCircle } from "lucide-react"
import { clampOverlayOpacity, OVERLAY_OPACITY_DEFAULT, getDefaultOverlayOpacity } from "./lib/overlayAppearance"
import { analytics } from "./lib/analytics/analytics.service"
import { ErrorBoundary } from "./components/ErrorBoundary"

const queryClient = new QueryClient()

const App: React.FC = () => {
  const isSettingsWindow = new URLSearchParams(window.location.search).get('window') === 'settings';
  const isLauncherWindow = new URLSearchParams(window.location.search).get('window') === 'launcher';
  const isOverlayWindow = new URLSearchParams(window.location.search).get('window') === 'overlay';
  const isModelSelectorWindow = new URLSearchParams(window.location.search).get('window') === 'model-selector';
  const isCropperWindow = new URLSearchParams(window.location.search).get('window') === 'cropper';

  // Default to launcher if not specified (dev mode safety)
  const isDefault = !isSettingsWindow && !isOverlayWindow && !isModelSelectorWindow && !isCropperWindow;

  if (isCropperWindow) {
    const Cropper = React.lazy(() => import('./components/Cropper'));
    return (
      <React.Suspense fallback={<div className="w-screen h-screen bg-transparent" />}>
        <Cropper />
      </React.Suspense>
    );
  }

  // Initialize Analytics
  useEffect(() => {
    // Only init if we are in a main window context to avoid duplicate events from helper windows
    // Actually, we probably want to track app open from the main entry point.
    // Let's protect initialization to ensure single run per window.
    // The service handles single-init, but let's be thoughtful about WHICH window tracks "App Open".
    // Launcher is the main entry. Overlay is the "Assistant".

    analytics.initAnalytics();

    if (isLauncherWindow || isDefault) {
      analytics.trackAppOpen();
    }

    if (isOverlayWindow) {
      analytics.trackAssistantStart();
    }

    // Cleanup / Session End
    const handleUnload = () => {
      if (isOverlayWindow) {
        analytics.trackAssistantStop();
      }
      if (isLauncherWindow || isDefault) {
        analytics.trackAppClose();
      }
    };

    window.addEventListener('beforeunload', handleUnload);
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
    };
  }, [isLauncherWindow, isOverlayWindow, isDefault]);

  // State
  const [showStartup, setShowStartup] = useState(true);
  // First-run guided onboarding (keys, permissions, how-to). Shows once.
  const [showOnboarding, setShowOnboarding] = useState<boolean>(() => {
    try {
      return localStorage.getItem('hasOnboarded') !== 'true';
    } catch {
      return false;
    }
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState('general');

  // Overlay opacity — only meaningful when isOverlayWindow, but stored centrally
  // so it can be initialized once from localStorage and updated via IPC.
  const [overlayOpacity, setOverlayOpacity] = useState<number>(() => {
    const stored = localStorage.getItem('natively_overlay_opacity');
    const parsed = stored ? parseFloat(stored) : NaN;
    // Treat missing value or the old default (0.65) as "not user-set"
    const isUserSet = Number.isFinite(parsed) && parsed !== OVERLAY_OPACITY_DEFAULT;
    return isUserSet ? clampOverlayOpacity(parsed) : getDefaultOverlayOpacity();
  });
  
  const [isLauncherMainView, setIsLauncherMainView] = useState(true);

  // Re-index State
  const [incompatibleWarning, setIncompatibleWarning] = useState<{count: number; oldProvider: string; newProvider: string} | null>(null);
  const [meetingAudioError, setMeetingAudioError] = useState<string | null>(null);
  const [screenRecordingDenied, setScreenRecordingDenied] = useState<boolean>(false);
  
  useEffect(() => {
    // Clean up old local storage
    localStorage.removeItem('useLegacyAudioBackend');

    // Keep local meeting lists fresh without triggering upsell campaigns.
    const removeMeetingsListener = window.electronAPI?.onMeetingsUpdated?.(() => {
      console.log("[App.tsx] Meetings updated.");
    });

    let removeWarning: (() => void) | undefined;
    if (window.electronAPI?.onIncompatibleProviderWarning) {
      removeWarning = window.electronAPI.onIncompatibleProviderWarning((data) => {
        setIncompatibleWarning(data);
      });
    }

    let removeMeetingAudioError: (() => void) | undefined;
    if (window.electronAPI?.onMeetingAudioError) {
      removeMeetingAudioError = window.electronAPI.onMeetingAudioError((message) => {
        setMeetingAudioError(message || 'Audio failed to start.');
      });
    }

    let removeScreenRecDenied: (() => void) | undefined;
    if (window.electronAPI?.onSystemAudioPermissionDenied) {
      removeScreenRecDenied = window.electronAPI.onSystemAudioPermissionDenied(() => {
        setScreenRecordingDenied(true);
      });
    }

    return () => {
      if (removeMeetingsListener) removeMeetingsListener();
      if (removeWarning) removeWarning();
      if (removeMeetingAudioError) removeMeetingAudioError();
      if (removeScreenRecDenied) removeScreenRecDenied();
    }
  }, []);

  // Listen for overlay opacity changes — scoped to overlay window only
  useEffect(() => {
    if (!isOverlayWindow) return;
    const removeOpacityListener = window.electronAPI?.onOverlayOpacityChanged?.((opacity) => {
      setOverlayOpacity(opacity);
    });
    return () => {
      if (removeOpacityListener) removeOpacityListener();
    };
  }, [isOverlayWindow]);

  // Keep native BrowserWindow opacity synchronized with the overlay setting.
  useEffect(() => {
    if (!isOverlayWindow || !window.electronAPI?.setOverlayOpacity) return;
    window.electronAPI.setOverlayOpacity(overlayOpacity).catch(() => {});
  }, [isOverlayWindow, overlayOpacity]);

  // When the theme switches and no user preference is stored, reset to theme-aware default
  useEffect(() => {
    if (!isOverlayWindow || !window.electronAPI?.onThemeChanged) return;
    return window.electronAPI.onThemeChanged(() => {
      const stored = localStorage.getItem('natively_overlay_opacity');
      if (!stored) {
        setOverlayOpacity(getDefaultOverlayOpacity());
      }
    });
  }, [isOverlayWindow]);


  // Handlers
  const handleReindex = async () => {
    if (window.electronAPI?.reindexIncompatibleMeetings) {
      setIncompatibleWarning(null);
      await window.electronAPI.reindexIncompatibleMeetings();
    }
  };

  const handleStartMeeting = async () => {
    try {
      setMeetingAudioError(null);
      localStorage.setItem('natively_last_meeting_start', Date.now().toString());
      const inputDeviceId = localStorage.getItem('preferredInputDeviceId');
      let outputDeviceId = localStorage.getItem('preferredOutputDeviceId');
      const useExperimentalSck = localStorage.getItem('useExperimentalSckBackend') === 'true';

      // Override output device ID to force SCK if experimental mode is enabled
      // Default to CoreAudio unless experimental is enabled
      if (useExperimentalSck) {
        console.log("[App] Using ScreenCaptureKit backend (Experimental).");
        outputDeviceId = "sck";
      } else {
        console.log("[App] Using CoreAudio backend (Default).");
      }

      const result = await window.electronAPI.startMeeting({
        audio: { inputDeviceId, outputDeviceId }
      });
      if (result.success) {
        analytics.trackMeetingStarted();
        // Switch to Overlay Mode via IPC
        // The main process handles window switching, but we can reinforce it or just trust main.
        // Actually, main process startMeeting triggers nothing UI-wise unless we tell it to switch window
        // But we configured main.ts to not auto-switch?
        // Let's explicitly request mode change.
        await window.electronAPI.setWindowMode('overlay');
      } else {
        console.error("Failed to start meeting:", result.error);
        localStorage.removeItem('natively_last_meeting_start');
        setMeetingAudioError(result.error || 'Failed to start meeting audio.');
        await window.electronAPI.setWindowMode('launcher', true);
      }
    } catch (err) {
      console.error("Failed to start meeting:", err);
      localStorage.removeItem('natively_last_meeting_start');
      setMeetingAudioError((err as Error)?.message || 'Failed to start meeting audio.');
      await window.electronAPI.setWindowMode('launcher', true);
    }
  };

  const handleEndMeeting = async () => {
    console.log("[App.tsx] handleEndMeeting triggered");
    analytics.trackMeetingEnded();
    try {
      await window.electronAPI.endMeeting();
      console.log("[App.tsx] endMeeting IPC completed");
      
      const startStr = localStorage.getItem('natively_last_meeting_start');
      if (startStr) {
        localStorage.removeItem('natively_last_meeting_start');
      }

      // Close overlay and bring launcher back visibly.
      await window.electronAPI.setWindowMode('launcher');
    } catch (err) {
      console.error("Failed to end meeting:", err);
      window.electronAPI.setWindowMode('launcher');
    }
  };

  // Render Logic
  if (isSettingsWindow) {
    return (
      <ErrorBoundary context="SettingsPopup">
        <div className="h-full min-h-0 w-full">
          <QueryClientProvider client={queryClient}>
            <ToastProvider>
              <SettingsPopup />
              <ToastViewport />
            </ToastProvider>
          </QueryClientProvider>
        </div>
      </ErrorBoundary>
    );
  }

  if (isModelSelectorWindow) {
    return (
      <ErrorBoundary context="ModelSelector">
        <div className="h-full min-h-0 w-full overflow-hidden">
          <QueryClientProvider client={queryClient}>
            <ToastProvider>
              <ModelSelectorWindow />
              <ToastViewport />
            </ToastProvider>
          </QueryClientProvider>
        </div>
      </ErrorBoundary>
    );
  }

  // --- OVERLAY WINDOW (Meeting Interface) ---
  if (isOverlayWindow) {
    return (
      <ErrorBoundary context="Overlay">
        <div className="w-full relative bg-transparent">
          <QueryClientProvider client={queryClient}>
            <ToastProvider>
              <div
                style={{
                  ['--overlay-opacity' as '--overlay-opacity']: String(overlayOpacity),
                  transition: 'background-color 75ms ease, border-color 75ms ease, box-shadow 75ms ease'
                } as React.CSSProperties}
              >
                <NativelyInterface
                  onEndMeeting={handleEndMeeting}
                  overlayOpacity={overlayOpacity}
                />
              </div>
              <ToastViewport />
            </ToastProvider>
          </QueryClientProvider>
        </div>
      </ErrorBoundary>
    );
  }

  // --- LAUNCHER WINDOW (Default) ---
  // Renders if window=launcher OR no param
  return (
    <ErrorBoundary context="Launcher">
    <div className="h-full min-h-0 w-full relative bg-[#000000]">
      <AnimatePresence>
        {showOnboarding ? (
          <motion.div
            key="onboarding"
            className="h-full w-full"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.4, ease: "easeInOut" } }}
          >
            <Onboarding
              onComplete={() => {
                try { localStorage.setItem('hasOnboarded', 'true'); } catch { /* ignore */ }
                setShowOnboarding(false);
              }}
            />
          </motion.div>
        ) : showStartup ? (
          <motion.div
            key="startup"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 1.1, pointerEvents: "none", transition: { duration: 0.6, ease: "easeInOut" } }}
          >
            <StartupSequence onComplete={() => setShowStartup(false)} />
          </motion.div>
        ) : (
          <motion.div
            key="main"
            className="h-full w-full"
            initial={{ opacity: 0, scale: 0.98, y: 15 }} // "Linear" style entry: slightly down and scaled down
            animate={{ opacity: 1, scale: 1, y: 0 }}      // Slide up and snap to place
            transition={{
              duration: 0.8,
              ease: [0.19, 1, 0.22, 1], // Expo-out: snappy start, smooth landing
              delay: 0.1
            }}
          >
            <QueryClientProvider client={queryClient}>
              <ToastProvider>
                <div id="launcher-container" className="h-full w-full relative">
                  <Launcher
                    onStartMeeting={handleStartMeeting}
                    onOpenSettings={(tab = 'general') => {
                      setSettingsInitialTab(tab);
                      setIsSettingsOpen(true);
                    }}
                    onPageChange={setIsLauncherMainView}
                  />
                </div>
                <SettingsOverlay
                  isOpen={isSettingsOpen}
                  onClose={() => {
                    setIsSettingsOpen(false);
                  }}
                  initialTab={settingsInitialTab}
                />
                <ToastViewport />
              </ToastProvider>
            </QueryClientProvider>
          </motion.div>
        )}
      </AnimatePresence>


      <AnimatePresence>
        {incompatibleWarning && isDefault && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed bottom-6 right-6 z-50 pointer-events-auto"
          >
            <div className="bg-[#1A1A1A] border border-[#ff3333]/30 shadow-2xl rounded-2xl p-5 max-w-[340px] flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-[#ff3333] shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-[#E0E0E0] font-medium text-sm">Provider Changed</h3>
                  <p className="text-[#A0A0A0] text-xs mt-1 leading-relaxed">
                    ⚠ {incompatibleWarning.count} meetings used your previous AI provider ({incompatibleWarning.oldProvider}) and won't appear in search results under {incompatibleWarning.newProvider}.
                  </p>
                </div>
              </div>
              <div className="flex gap-2 mt-1 justify-end">
                <button 
                  onClick={() => setIncompatibleWarning(null)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-[#A0A0A0] hover:text-white hover:bg-white/5 transition-colors"
                >
                  Dismiss
                </button>
                <button 
                  onClick={handleReindex}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#ff3333]/10 text-[#ff3333] hover:bg-[#ff3333]/20 transition-colors"
                >
                  Re-index automatically
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {meetingAudioError && isDefault && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97 }}
            className="fixed bottom-6 left-6 z-50 pointer-events-auto"
          >
            <div className="bg-[#1A1A1A] border border-[#ff3333]/30 shadow-2xl rounded-2xl p-4 max-w-[420px] flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-[#ff3333] shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-[#E0E0E0] font-medium text-sm">Meeting audio failed to start</h3>
                <p className="text-[#A0A0A0] text-xs mt-1 leading-relaxed">
                  {meetingAudioError}
                </p>
              </div>
              <button
                onClick={() => setMeetingAudioError(null)}
                className="text-xs px-3 py-1.5 rounded-lg text-[#A0A0A0] hover:text-white hover:bg-white/5 transition-colors"
              >
                Dismiss
              </button>
              {(meetingAudioError.includes('OpenRouter') || meetingAudioError.includes('Deepgram') || meetingAudioError.includes('Settings')) && (
                <button
                  onClick={() => {
                    setSettingsInitialTab('ai-providers');
                    setIsSettingsOpen(true);
                    setMeetingAudioError(null);
                  }}
                  className="text-xs px-3 py-1.5 rounded-lg text-white bg-white/10 hover:bg-white/15 transition-colors whitespace-nowrap"
                >
                  Open settings
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {screenRecordingDenied && isDefault && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97 }}
            className="fixed bottom-6 left-6 z-50 pointer-events-auto"
          >
            <div className="bg-[#1A1A1A] border border-amber-500/30 shadow-2xl rounded-2xl p-4 max-w-[420px] flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-[#E0E0E0] font-medium text-sm">System audio is off</h3>
                <p className="text-[#A0A0A0] text-xs mt-1 leading-relaxed">
                  The other person won't be transcribed until you grant Screen Recording, then restart the app. Your microphone still works.
                </p>
              </div>
              <button
                onClick={() => setScreenRecordingDenied(false)}
                className="text-xs px-3 py-1.5 rounded-lg text-[#A0A0A0] hover:text-white hover:bg-white/5 transition-colors"
              >
                Dismiss
              </button>
              <button
                onClick={() => window.electronAPI?.openScreenRecordingSettings?.()}
                className="text-xs px-3 py-1.5 rounded-lg text-white bg-white/10 hover:bg-white/15 transition-colors whitespace-nowrap"
              >
                Open settings
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <UpdateBanner />
    </div>
    </ErrorBoundary>
  )
}

export default App
