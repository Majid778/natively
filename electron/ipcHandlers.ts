// ipcHandlers.ts

import { app, ipcMain, shell, dialog, desktopCapturer, systemPreferences, BrowserWindow, screen } from "electron"
import type { OpenDialogOptions } from "electron"
import { AppState } from "./main"
import { GEMINI_FLASH_MODEL } from "./IntelligenceManager"
import { DatabaseManager } from "./db/DatabaseManager"; // Import Database Manager
import * as path from "path";
import * as fs from "fs";
import { AudioDevices } from "./audio/AudioDevices";


import { RECOGNITION_LANGUAGES, AI_RESPONSE_LANGUAGES } from "./config/languages"
import { WhisperCppManager } from "./services/WhisperCppManager";

export function initializeIpcHandlers(appState: AppState): void {
  const safeHandle = (channel: string, listener: (event: any, ...args: any[]) => Promise<any> | any) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, listener);
  };

  // --- NEW Test Helper ---
  safeHandle("test-release-fetch", async () => {
    try {
      console.log("[IPC] Manual Test Fetch triggered (forcing refresh)...");
      const { ReleaseNotesManager } = require('./update/ReleaseNotesManager');
      const notes = await ReleaseNotesManager.getInstance().fetchReleaseNotes('latest', true);

      if (notes) {
        console.log("[IPC] Notes fetched for:", notes.version);
        const info = {
          version: notes.version || 'latest',
          files: [] as any[],
          path: '',
          sha512: '',
          releaseName: notes.summary,
          releaseNotes: notes.fullBody,
          parsedNotes: notes
        };
        // Send to renderer
        appState.getMainWindow()?.webContents.send("update-available", info);
        return { success: true };
      }
      return { success: false, error: "No notes returned" };
    } catch (err: any) {
      console.error("[IPC] test-release-fetch failed:", err);
      return { success: false, error: err.message };
    }
  });

  safeHandle("get-recognition-languages", async () => {
    return RECOGNITION_LANGUAGES;
  });

  safeHandle("get-ai-response-languages", async () => {
    return AI_RESPONSE_LANGUAGES;
  });

  safeHandle("set-ai-response-language", async (_, language: string) => {
    // Validate: must be a non-empty string
    if (!language || typeof language !== 'string' || !language.trim()) {
      console.warn('[IPC] set-ai-response-language: invalid or empty language received, ignoring.');
      return { success: false, error: 'Invalid language value' };
    }
    const sanitizedLanguage = language.trim();
    const { CredentialsManager } = require('./services/CredentialsManager');
    // Persist to disk
    CredentialsManager.getInstance().setAiResponseLanguage(sanitizedLanguage);
    // Update live in-memory LLMHelper (same instance used by IntelligenceEngine)
    const llmHelper = appState.processingHelper?.getLLMHelper?.();
    if (llmHelper) {
      llmHelper.setAiResponseLanguage(sanitizedLanguage);
      console.log(`[IPC] AI response language updated to: ${sanitizedLanguage}`);
    } else {
      console.warn('[IPC] set-ai-response-language: processingHelper or LLMHelper not ready, language saved to disk only.');
    }
    return { success: true };
  });

  safeHandle("get-stt-language", async () => {
    const { CredentialsManager } = require('./services/CredentialsManager');
    return CredentialsManager.getInstance().getSttLanguage();
  });

  safeHandle("get-ai-response-language", async () => {
    const { CredentialsManager } = require('./services/CredentialsManager');
    return CredentialsManager.getInstance().getAiResponseLanguage();
  });
  safeHandle(
    "update-content-dimensions",
    async (event, { width, height }: { width: number; height: number }) => {
      if (!width || !height) return

      const senderWebContents = event.sender
      const settingsWin = appState.settingsWindowHelper.getSettingsWindow()
      const overlayWin = appState.getWindowHelper().getOverlayWindow()
      const launcherWin = appState.getWindowHelper().getLauncherWindow()

      if (settingsWin && !settingsWin.isDestroyed() && settingsWin.webContents.id === senderWebContents.id) {
        appState.settingsWindowHelper.setWindowDimensions(settingsWin, width, height)
      } else if (
        overlayWin && !overlayWin.isDestroyed() && overlayWin.webContents.id === senderWebContents.id
      ) {
        // NativelyInterface logic - Resize ONLY the overlay window using dedicated method
        appState.getWindowHelper().setOverlayDimensions(width, height)
      } else if (
        launcherWin && !launcherWin.isDestroyed() && launcherWin.webContents.id === senderWebContents.id
      ) {
        // EC-05 fix: launcher window resize events were previously silently ignored.
        // Log them so that if the launcher ever sends this IPC it's visible in logs.
        console.log(`[IPC] update-content-dimensions: launcher window resize request ${width}x${height} (ignored â€” launcher has fixed dimensions)`);
      }
    }
  )

  safeHandle("set-window-mode", async (event, mode: 'launcher' | 'overlay', inactive?: boolean) => {
    if (mode === 'overlay' && !appState.getIsMeetingActive()) {
      console.warn('[IPC] Ignoring overlay mode request while no meeting is active.');
      return { success: false, error: 'Meeting is not active.' };
    }

    appState.getWindowHelper().setWindowMode(mode, inactive);
    return { success: true };
  })


  safeHandle("delete-screenshot", async (event, filePath: string) => {
    // Guard: only allow deletion of files within the app's own userData directory
    const userDataDir = app.getPath('userData');
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(userDataDir + path.sep)) {
      console.warn('[IPC] delete-screenshot: path outside userData rejected:', filePath);
      return { success: false, error: 'Path not allowed' };
    }
    return appState.deleteScreenshot(resolved);
  })

  safeHandle("take-screenshot", async () => {
    try {
      const screenshotPath = await appState.takeScreenshot()
      const preview = await appState.getImagePreview(screenshotPath)
      return { path: screenshotPath, preview }
    } catch (error) {
      // console.error("Error taking screenshot:", error)
      throw error
    }
  })

  safeHandle("take-selective-screenshot", async () => {
    try {
      const screenshotPath = await appState.takeSelectiveScreenshot()
      const preview = await appState.getImagePreview(screenshotPath)
      return { path: screenshotPath, preview }
    } catch (error) {
      // EC-04 fix: cast unknown error to Error before accessing .message
      if ((error as Error).message === "Selection cancelled") {
        return { cancelled: true }
      }
      throw error
    }
  })

  safeHandle("get-screenshots", async () => {
    // console.log({ view: appState.getView() })
    try {
      let previews = []
      if (appState.getView() === "queue") {
        previews = await Promise.all(
          appState.getScreenshotQueue().map(async (path) => ({
            path,
            preview: await appState.getImagePreview(path)
          }))
        )
      } else {
        previews = await Promise.all(
          appState.getExtraScreenshotQueue().map(async (path) => ({
            path,
            preview: await appState.getImagePreview(path)
          }))
        )
      }
      // previews.forEach((preview: any) => console.log(preview.path))
      return previews
    } catch (error) {
      // console.error("Error getting screenshots:", error)
      throw error
    }
  })

  safeHandle("toggle-window", async () => {
    appState.toggleMainWindow()
  })

  safeHandle("show-window", async (event, inactive?: boolean) => {
    // Default show main window (Launcher usually)
    appState.showMainWindow(inactive)
  })

  safeHandle("hide-window", async () => {
    appState.hideMainWindow()
  })

  safeHandle("show-overlay", async () => {
    if (!appState.getIsMeetingActive()) {
      console.warn('[IPC] Ignoring show-overlay request while no meeting is active.');
      return { success: false, error: 'Meeting is not active.' };
    }

    appState.getWindowHelper().showOverlay();
    return { success: true };
  })

  safeHandle("hide-overlay", async () => {
    appState.getWindowHelper().hideOverlay();
  })

  safeHandle("get-meeting-active", async () => {
    return appState.getIsMeetingActive();
  })

  safeHandle("reset-queues", async () => {
    try {
      appState.clearQueues()
      // console.log("Screenshot queues have been cleared.")
      return { success: true }
    } catch (error: any) {
      // console.error("Error resetting queues:", error)
      return { success: false, error: error.message }
    }
  })


  // Generate suggestion from transcript - live-assistant style text-only reasoning
  safeHandle("generate-suggestion", async (event, context: string, lastQuestion: string) => {
    try {
      const suggestion = await appState.processingHelper.getLLMHelper().generateSuggestion(context, lastQuestion)
      return { suggestion }
    } catch (error: any) {
      // console.error("Error generating suggestion:", error)
      throw error
    }
  })

  // Turn a freeform description into a Mode (copilot system) prompt. Calls the
  // user's CONFIGURED text model with skipSystemPrompt=true so no copilot mode or
  // meeting context leaks in. Returns one polished prompt.
  safeHandle("generate-mode-prompt", async (_event, payload: { description?: string }) => {
    try {
      const description = (payload?.description || '').trim();
      if (!description) {
        return { success: false, error: 'Describe what you want this mode to do first.' };
      }

      const metaPrompt = `You write a SYSTEM PROMPT for a real-time spoken copilot. The prompt you produce is injected before live-call context; the model's output is read aloud or paraphrased by the user in the moment. The system prompt you write must instruct the copilot to:
- speak in the FIRST PERSON as the user (generate what THEY should say),
- produce CONCISE, natural, speakable lines suited to a live call — never essays,
- stay confident, specific, and practical, and never invent facts about the user,
- fit what the user describes below.

What the user wants:
${description}

Output ONLY the system prompt text itself — no preamble, no surrounding quotes, no markdown, no explanation.`;

      const llm = appState.processingHelper.getLLMHelper();
      const raw = await llm.chatWithGemini(metaPrompt, undefined, undefined, true);
      const prompt = (raw || '')
        .trim()
        .replace(/^```[a-zA-Z]*\n?/, '')
        .replace(/\n?```$/, '')
        .replace(/^["']|["']$/g, '')
        .trim();

      if (!prompt) {
        return { success: false, error: 'No prompt was generated. Check your text model key in AI Providers.' };
      }
      return { success: true, prompt };
    } catch (error: any) {
      return { success: false, error: error?.message || 'Failed to generate prompt.' };
    }
  })

  safeHandle("finalize-mic-stt", async () => {
    appState.finalizeMicSTT();
  });

  safeHandle("force-end-sentence", async () => {
    appState.forceEndSentenceNow();
  });

  // IPC handler for analyzing image from file path
  safeHandle("analyze-image-file", async (event, filePath: string) => {
    // Guard: only allow reading files within the app's own userData directory
    const userDataDir = app.getPath('userData');
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(userDataDir + path.sep)) {
      console.warn('[IPC] analyze-image-file: path outside userData rejected:', filePath);
      throw new Error('Path not allowed');
    }
    try {
      const result = await appState.processingHelper.getLLMHelper().analyzeImageFiles([resolved])
      return result
    } catch (error: any) {
      throw error
    }
  })

  safeHandle("gemini-chat", async (event, message: string, imagePaths?: string[], context?: string, options?: { skipSystemPrompt?: boolean }) => {
    try {
      const result = await appState.processingHelper.getLLMHelper().chatWithGemini(message, imagePaths, context, options?.skipSystemPrompt);

      console.log(`[IPC] gemini - chat response: `, result ? result.substring(0, 50) : "(empty)");

      // Don't process empty responses
      if (!result || result.trim().length === 0) {
        console.warn("[IPC] Empty response from LLM, not updating IntelligenceManager");
        return "I apologize, but I couldn't generate a response. Please try again.";
      }

      // Sync with IntelligenceManager so Follow-Up/Recap work
      const intelligenceManager = appState.getIntelligenceManager();

      // 1. Add user question to context (as 'user')
      // CRITICAL: Skip refinement check to prevent auto-triggering follow-up logic
      // The user's manual question is a NEW input, not a refinement of previous answer.
      intelligenceManager.addTranscript({
        text: message,
        speaker: 'user',
        timestamp: Date.now(),
        final: true
      }, true);

      // 2. Add assistant response and set as last message
      console.log(`[IPC] Updating IntelligenceManager with assistant message...`);
      intelligenceManager.addAssistantMessage(result);
      console.log(`[IPC] Updated IntelligenceManager.Last message: `, intelligenceManager.getLastAssistantMessage()?.substring(0, 50));

      // Log Usage
      intelligenceManager.logUsage('chat', message, result);

      return result;
    } catch (error: any) {
      // console.error("Error in gemini-chat handler:", error);
      throw error;
    }
  });

  // Streaming IPC Handler
  // SECURITY FIX (P0-1): Monotonic stream ID prevents interleaved tokens from concurrent stream requests.
  // Each new invocation increments the ID; any in-flight iteration bails as soon as it detects
  // that a newer stream has taken over.
  let _chatStreamId = 0;

  safeHandle("gemini-chat-stream", async (event, message: string, imagePaths?: string[], context?: string, options?: { skipSystemPrompt?: boolean }) => {
    try {
      console.log("[IPC] gemini-chat-stream started using LLMHelper.streamChat");
      const llmHelper = appState.processingHelper.getLLMHelper();

      // Claim a new stream ID â€” any prior stream will detect this and stop emitting.
      const myStreamId = ++_chatStreamId;

      // Update IntelligenceManager with USER message immediately
      const intelligenceManager = appState.getIntelligenceManager();
      intelligenceManager.addTranscript({
        text: message,
        speaker: 'user',
        timestamp: Date.now(),
        final: true
      }, true);

      let fullResponse = "";

      // Context Injection for "Answer" button (100s rolling window)
      if (!context) {
        // User requested 100 seconds of context for the answer button
        // Logic: If no explicit context provided (like from manual override), auto-inject from IntelligenceManager
        try {
          const autoContext = intelligenceManager.getFormattedContext(100);
          if (autoContext && autoContext.trim().length > 0) {
            context = autoContext;
            console.log(`[IPC] Auto - injected 100s context for gemini - chat - stream(${context.length} chars)`);
          }
        } catch (ctxErr) {
          console.warn("[IPC] Failed to auto-inject context:", ctxErr);
        }
      }

      try {
        // USE streamChat which handles routing
        const stream = llmHelper.streamChat(message, imagePaths, context, options?.skipSystemPrompt ? "" : undefined);

        for await (const token of stream) {
          // Bail if a newer stream has taken over (user triggered a new request)
          if (_chatStreamId !== myStreamId) {
            console.log(`[IPC] gemini-chat-stream ${myStreamId} superseded by ${_chatStreamId}, stopping.`);
            return null;
          }
          event.sender.send("gemini-stream-token", token);
          fullResponse += token;
        }

        // Final check: only send done if we are still the active stream
        if (_chatStreamId === myStreamId) {
          event.sender.send("gemini-stream-done");

          // Update IntelligenceManager with ASSISTANT message after completion
          if (fullResponse.trim().length > 0) {
            intelligenceManager.addAssistantMessage(fullResponse);
            // Log Usage for streaming chat
            intelligenceManager.logUsage('chat', message, fullResponse);
          }
        }

      } catch (streamError: any) {
        console.error("[IPC] Streaming error:", streamError);
        if (_chatStreamId === myStreamId) {
          event.sender.send("gemini-stream-error", streamError.message || "Unknown streaming error");
        }
      }

      return null; // Return null as data is sent via events

    } catch (error: any) {
      console.error("[IPC] Error in gemini-chat-stream setup:", error);
      throw error;
    }
  });



  safeHandle("quit-app", () => {
    app.quit()
  })

  safeHandle("quit-and-install-update", async () => {
    try {
      console.log('[IPC] Quit and install update requested')
      await appState.quitAndInstallUpdate()
      return { success: true }
    } catch (err: any) {
      console.error('[IPC] quit-and-install-update failed:', err)
      return { success: false, error: err.message }
    }
  })

  safeHandle("delete-meeting", async (_, id: string) => {
    return DatabaseManager.getInstance().deleteMeeting(id);
  });

  safeHandle("check-for-updates", async () => {
    try {
      console.log('[IPC] Manual update check requested')
      await appState.checkForUpdates()
      return { success: true }
    } catch (err: any) {
      console.error('[IPC] check-for-updates failed:', err)
      return { success: false, error: err.message }
    }
  })

  safeHandle("download-update", async () => {
    try {
      console.log('[IPC] Download update requested')
      appState.downloadUpdate()
      return { success: true }
    } catch (err: any) {
      console.error('[IPC] download-update failed:', err)
      return { success: false, error: err.message }
    }
  })

  // Window movement handlers
  safeHandle("move-window-left", async () => {
    appState.moveWindowLeft()
  })

  safeHandle("move-window-right", async () => {
    appState.moveWindowRight()
  })

  safeHandle("move-window-up", async () => {
    appState.moveWindowUp()
  })

  safeHandle("move-window-down", async () => {
    appState.moveWindowDown()
  })

  safeHandle("center-and-show-window", async () => {
    appState.centerAndShowWindow()
  })

  // Window Controls
  safeHandle("window-minimize", async () => {
    appState.getWindowHelper().minimizeWindow();
  });

  safeHandle("window-maximize", async () => {
    appState.getWindowHelper().maximizeWindow();
  });

  safeHandle("window-close", async () => {
    appState.getWindowHelper().closeWindow();
  });

  safeHandle("window-is-maximized", async () => {
    return appState.getWindowHelper().isMainWindowMaximized();
  });

  // Settings Window
  safeHandle("toggle-settings-window", (event, { x, y } = {}) => {
    appState.settingsWindowHelper.toggleWindow(x, y)
  })

  safeHandle("close-settings-window", () => {
    appState.settingsWindowHelper.closeWindow()
  })



  safeHandle("set-undetectable", async (_, state: boolean) => {
    appState.setUndetectable(state)
    return { success: true }
  })

  safeHandle("set-disguise", async (_, mode: 'terminal' | 'settings' | 'activity' | 'none') => {
    appState.setDisguise(mode)
    return { success: true }
  })

  safeHandle("get-undetectable", async () => {
    return appState.getUndetectable()
  })

  // Adapted from public PR #113 â€” verify overlay interaction
  safeHandle("set-overlay-mouse-passthrough", async (_, enabled: boolean) => {
    appState.setOverlayMousePassthrough(enabled)
    return { success: true }
  })

  safeHandle("toggle-overlay-mouse-passthrough", async () => {
    const enabled = appState.toggleOverlayMousePassthrough()
    return { success: true, enabled }
  })

  safeHandle("get-overlay-mouse-passthrough", async () => {
    return appState.getOverlayMousePassthrough()
  })

  safeHandle("get-disguise", async () => {
    return appState.getDisguise()
  })

  safeHandle("set-open-at-login", async (_, openAtLogin: boolean) => {
    app.setLoginItemSettings({
      openAtLogin,
      openAsHidden: false,
      path: app.getPath('exe') // Explicitly point to executable for production reliability
    });
    return { success: true };
  });

  safeHandle("get-open-at-login", async () => {
    const settings = app.getLoginItemSettings();
    return settings.openAtLogin;
  });

  safeHandle("get-verbose-logging", async () => {
    return appState.getVerboseLogging();
  });

  safeHandle("set-verbose-logging", async (_, enabled: boolean) => {
    appState.setVerboseLogging(enabled);
    return { success: true };
  });

  safeHandle("get-arch", async () => {
    return process.arch;
  });

  // LLM Model Management Handlers
  safeHandle("get-current-llm-config", async () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      return {
        provider: llmHelper.getCurrentProvider(),
        model: llmHelper.getCurrentModel()
      };
    } catch (error: any) {
      // console.error("Error getting current LLM config:", error);
      throw error;
    }
  });

  safeHandle("switch-to-gemini", async (_, apiKey?: string, modelId?: string) => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      await llmHelper.switchToGemini(apiKey, modelId);

      // Persist API key if provided
      if (apiKey) {
        const { CredentialsManager } = require('./services/CredentialsManager');
        CredentialsManager.getInstance().setGeminiApiKey(apiKey);
      }

      return { success: true };
    } catch (error: any) {
      // console.error("Error switching to Gemini:", error);
      return { success: false, error: error.message };
    }
  });

  // Dedicated API key setters (for Settings UI Save buttons)
  safeHandle("set-gemini-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setGeminiApiKey(apiKey);

      // Also update the LLMHelper immediately
      const llmHelper = appState.processingHelper.getLLMHelper();
      llmHelper.setApiKey(apiKey);

      // CQ-06 fix: cancel any in-flight LLM stream before swapping LLM clients.
      // Use resetEngine() (NOT reset()) so session transcript is preserved mid-meeting.
      // initializeLLMs() now also calls engine.reset() internally for double-safety.
      appState.getIntelligenceManager().resetEngine();
      // Re-init IntelligenceManager
      appState.getIntelligenceManager().initializeLLMs();

      return { success: true };
    } catch (error: any) {
      console.error("Error saving Gemini API key:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-groq-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setGroqApiKey(apiKey);

      // Also update the LLMHelper immediately
      const llmHelper = appState.processingHelper.getLLMHelper();
      llmHelper.setGroqApiKey(apiKey);

      // CQ-06 fix: cancel in-flight stream before re-init (engine only, not session)
      appState.getIntelligenceManager().resetEngine();
      // Re-init IntelligenceManager
      appState.getIntelligenceManager().initializeLLMs();

      return { success: true };
    } catch (error: any) {
      console.error("Error saving Groq API key:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-openai-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setOpenaiApiKey(apiKey);

      // Also update the LLMHelper immediately
      const llmHelper = appState.processingHelper.getLLMHelper();
      llmHelper.setOpenaiApiKey(apiKey);

      // CQ-06 fix: cancel in-flight stream before re-init (engine only, not session)
      appState.getIntelligenceManager().resetEngine();
      // Re-init IntelligenceManager
      appState.getIntelligenceManager().initializeLLMs();

      return { success: true };
    } catch (error: any) {
      console.error("Error saving OpenAI API key:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-claude-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setClaudeApiKey(apiKey);

      // Also update the LLMHelper immediately
      const llmHelper = appState.processingHelper.getLLMHelper();
      llmHelper.setClaudeApiKey(apiKey);

      // CQ-06 fix: cancel in-flight stream before re-init (engine only, not session)
      appState.getIntelligenceManager().resetEngine();
      // Re-init IntelligenceManager
      appState.getIntelligenceManager().initializeLLMs();

      return { success: true };
    } catch (error: any) {
      console.error("Error saving Claude API key:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-openrouter-api-key", async (_, apiKey: string) => {
    try {
      const key = typeof apiKey === 'string' ? apiKey.trim() : '';
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setOpenRouterApiKey(key);
      return { success: true };
    } catch (error: any) {
      console.error("Error saving OpenRouter API key:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("validate-openrouter-key", async (_, apiKey: string) => {
    const key = typeof apiKey === 'string' ? apiKey.trim() : '';
    if (!key) {
      return { success: false, error: 'OpenRouter API key is required.' };
    }
    if (!key.startsWith('sk-or-v1-')) {
      return { success: false, error: 'OpenRouter keys should start with "sk-or-v1-".' };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch('https://openrouter.ai/api/v1/key', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      const payload = await response.json().catch((): null => null);
      if (!response.ok) {
        const message =
          payload?.error?.message ||
          payload?.message ||
          (response.status === 401 || response.status === 403
            ? 'OpenRouter rejected this key.'
            : `OpenRouter returned HTTP ${response.status}.`);
        return { success: false, error: message };
      }

      const data = payload?.data || payload || {};
      const asNumberOrNull = (value: unknown): number | null => {
        if (value === null || value === undefined || value === '') return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      };

      const usage = asNumberOrNull(data.usage);
      const limit = asNumberOrNull(data.limit);
      const limitRemaining = asNumberOrNull(
        data.limit_remaining ?? data.limitRemaining ?? data.remaining_credits ?? data.remainingCredits
      );
      const hasCredits = limitRemaining === null ? true : limitRemaining > 0;

      return {
        success: true,
        label: typeof data.label === 'string' ? data.label : undefined,
        usage,
        limit,
        limitRemaining,
        hasCredits,
        isFreeTier: Boolean(data.is_free_tier ?? data.isFreeTier),
      };
    } catch (error: any) {
      const isAbort = error?.name === 'AbortError';
      return {
        success: false,
        error: isAbort ? 'OpenRouter validation timed out.' : (error?.message || 'Unable to validate OpenRouter key.'),
      };
    } finally {
      clearTimeout(timeout);
    }
  });

  // Custom Provider Handlers
  safeHandle("get-custom-providers", async () => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const cm = CredentialsManager.getInstance();
      // Merge new Curl Providers with legacy Custom Providers
      // New ones take precedence if IDs conflict (though unlikely as UUIDs)
      const curlProviders = cm.getCurlProviders();
      const legacyProviders = cm.getCustomProviders() || [];
      return [...curlProviders, ...legacyProviders];
    } catch (error: any) {
      console.error("Error getting custom providers:", error);
      return [];
    }
  });

  safeHandle("save-custom-provider", async (_, provider: unknown) => {
    try {
      // SECURITY FIX (P1-2): Validate provider payload shape before persisting.
      // Prevents malformed/malicious renderer data from polluting CredentialsManager.
      if (
        typeof provider !== 'object' || provider === null ||
        typeof (provider as any).id !== 'string' ||
        typeof (provider as any).name !== 'string' ||
        typeof (provider as any).curlCommand !== 'string'
      ) {
        console.error('[IPC] save-custom-provider: invalid payload shape', typeof provider);
        return { success: false, error: 'Invalid provider payload' };
      }

      const curlCmd: string = (provider as any).curlCommand;
      // Require {{TEXT}} so the app always has a defined injection point for the user prompt.
      // We do NOT require the string to start with 'curl' â€” curlCommand is a template field,
      // not necessarily a raw CLI string, and over-constraining it would break valid providers.
      if (!curlCmd.includes('{{TEXT}}')) {
        return { success: false, error: 'curlCommand must contain {{TEXT}} placeholder for the prompt' };
      }

      const { CredentialsManager } = require('./services/CredentialsManager');
      // Save as CurlProvider (supports responsePath)
      CredentialsManager.getInstance().saveCurlProvider(provider);
      return { success: true };
    } catch (error: any) {
      console.error("Error saving custom provider:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("delete-custom-provider", async (_, id: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      // Try deleting from both storages to be safe
      CredentialsManager.getInstance().deleteCurlProvider(id);
      CredentialsManager.getInstance().deleteCustomProvider(id);
      return { success: true };
    } catch (error: any) {
      console.error("Error deleting custom provider:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("switch-to-custom-provider", async (_, providerId: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const cm = CredentialsManager.getInstance();
      // BUG-05 fix: providers may be in either the curl or legacy custom store â€”
      // merge both when looking up by id so neither store is silently ignored.
      const provider = [
        ...(cm.getCurlProviders() || []),
        ...(cm.getCustomProviders() || [])
      ].find((p: any) => p.id === providerId);

      if (!provider) {
        throw new Error("Provider not found");
      }

      const llmHelper = appState.processingHelper.getLLMHelper();
      await llmHelper.switchToCustom(provider);

      // Re-init IntelligenceManager (optional, but good for consistency)
      appState.getIntelligenceManager().initializeLLMs();

      return { success: true };
    } catch (error: any) {
      console.error("Error switching to custom provider:", error);
      return { success: false, error: error.message };
    }
  });


  // cURL Provider Handlers
  safeHandle("get-curl-providers", async () => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      return CredentialsManager.getInstance().getCurlProviders();
    } catch (error: any) {
      console.error("Error getting curl providers:", error);
      return [];
    }
  });

  safeHandle("save-curl-provider", async (_, provider: any) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().saveCurlProvider(provider);
      return { success: true };
    } catch (error: any) {
      console.error("Error saving curl provider:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("delete-curl-provider", async (_, id: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().deleteCurlProvider(id);
      return { success: true };
    } catch (error: any) {
      console.error("Error deleting curl provider:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("switch-to-curl-provider", async (_, providerId: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const provider = CredentialsManager.getInstance().getCurlProviders().find((p: any) => p.id === providerId);

      if (!provider) {
        throw new Error("Provider not found");
      }

      const llmHelper = appState.processingHelper.getLLMHelper();
      await llmHelper.switchToCurl(provider);

      // Re-init IntelligenceManager (optional, but good for consistency)
      appState.getIntelligenceManager().initializeLLMs();

      return { success: true };
    } catch (error: any) {
      console.error("Error switching to curl provider:", error);
      return { success: false, error: error.message };
    }
  });

  // Get stored API keys (masked for UI display)
  safeHandle("get-stored-credentials", async () => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const creds = CredentialsManager.getInstance().getAllCredentials();

      // Return masked versions for security (just indicate if set)
      const hasKey = (key?: string) => !!(key && key.trim().length > 0);

      return {
        hasGeminiKey: hasKey(creds.geminiApiKey),
        hasGroqKey: hasKey(creds.groqApiKey),
        hasOpenaiKey: hasKey(creds.openaiApiKey),
        hasClaudeKey: hasKey(creds.claudeApiKey),
        hasOpenRouterKey: hasKey(creds.openRouterApiKey),
        openRouterApiKey: creds.openRouterApiKey || '',
        googleServiceAccountPath: creds.googleServiceAccountPath || null,
        sttProvider: creds.sttProvider || 'google',
        groqSttModel: creds.groqSttModel || 'whisper-large-v3-turbo',
        localSttModel: creds.localSttModel || 'large-v3-turbo',
        hasSttGroqKey: hasKey(creds.groqSttApiKey),
        hasSttOpenaiKey: hasKey(creds.openAiSttApiKey),
        hasDeepgramKey: hasKey(creds.deepgramApiKey),
        hasElevenLabsKey: hasKey(creds.elevenLabsApiKey),
        hasAzureKey: hasKey(creds.azureApiKey),
        azureRegion: creds.azureRegion || 'eastus',
        hasIbmWatsonKey: hasKey(creds.ibmWatsonApiKey),
        ibmWatsonRegion: creds.ibmWatsonRegion || 'us-south',
        hasSonioxKey: hasKey(creds.sonioxApiKey),
        // STT key values â€” returned so the settings UI can pre-populate input fields.
        // AI model keys (Gemini/Groq/OpenAI/Claude) remain boolean-only; STT keys are
        // surfaced here because users need to see which key is active when switching providers.
        sttGroqKey: creds.groqSttApiKey || '',
        sttOpenaiKey: creds.openAiSttApiKey || '',
        sttDeepgramKey: creds.deepgramApiKey || '',
        sttElevenLabsKey: creds.elevenLabsApiKey || '',
        sttAzureKey: creds.azureApiKey || '',
        sttIbmKey: creds.ibmWatsonApiKey || '',
        sttSonioxKey: creds.sonioxApiKey || '',
        // Dynamic Model Discovery - preferred models
        geminiPreferredModel: creds.geminiPreferredModel || undefined,
        groqPreferredModel: creds.groqPreferredModel || undefined,
        openaiPreferredModel: creds.openaiPreferredModel || undefined,
        claudePreferredModel: creds.claudePreferredModel || undefined,
      };
    } catch (error: any) {
        return { hasGeminiKey: false, hasGroqKey: false, hasOpenaiKey: false, hasClaudeKey: false, hasOpenRouterKey: false, openRouterApiKey: '', googleServiceAccountPath: null, sttProvider: 'google', groqSttModel: 'whisper-large-v3-turbo', localSttModel: 'large-v3-turbo', hasSttGroqKey: false, hasSttOpenaiKey: false, hasDeepgramKey: false, hasElevenLabsKey: false, hasAzureKey: false, azureRegion: 'eastus', hasIbmWatsonKey: false, ibmWatsonRegion: 'us-south', hasSonioxKey: false, sttGroqKey: '', sttOpenaiKey: '', sttDeepgramKey: '', sttElevenLabsKey: '', sttAzureKey: '', sttIbmKey: '', sttSonioxKey: '' };
    }
  });

  // ==========================================
  // Dynamic Model Discovery Handlers
  // ==========================================

  safeHandle("fetch-provider-models", async (_, provider: 'gemini' | 'groq' | 'openai' | 'claude', apiKey: string) => {
    try {
      // Fall back to stored key if no key was explicitly provided
      let key = apiKey?.trim();
      if (!key) {
        const { CredentialsManager } = require('./services/CredentialsManager');
        const cm = CredentialsManager.getInstance();
        if (provider === 'gemini') key = cm.getGeminiApiKey();
        else if (provider === 'groq') key = cm.getGroqApiKey();
        else if (provider === 'openai') key = cm.getOpenaiApiKey();
        else if (provider === 'claude') key = cm.getClaudeApiKey();
      }

      if (!key) {
        return { success: false, error: 'No API key available. Please save a key first.' };
      }

      const { fetchProviderModels } = require('./utils/modelFetcher');
      const models = await fetchProviderModels(provider, key);
      return { success: true, models };
    } catch (error: any) {
      console.error(`[IPC] Failed to fetch ${provider} models:`, error);
      const msg = error?.response?.data?.error?.message || error.message || 'Failed to fetch models';
      return { success: false, error: msg };
    }
  });

  safeHandle("set-provider-preferred-model", async (_, provider: 'gemini' | 'groq' | 'openai' | 'claude', modelId: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setPreferredModel(provider, modelId);
    } catch (error: any) {
      console.error(`[IPC] Failed to set preferred model for ${provider}:`, error);
    }
  });

  // ==========================================
  // STT Provider Management Handlers
  // ==========================================

  safeHandle("set-stt-provider", async (_, provider: 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox' | 'local-whisper') => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setSttProvider(provider);

      // Reconfigure the audio pipeline to use the new STT provider
      await appState.reconfigureSttProvider();

      return { success: true };
    } catch (error: any) {
      console.error("Error setting STT provider:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("get-stt-provider", async () => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      return CredentialsManager.getInstance().getSttProvider();
    } catch (error: any) {
      return 'google';
    }
  });

  safeHandle("set-groq-stt-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setGroqSttApiKey(apiKey);
      return { success: true };
    } catch (error: any) {
      console.error("Error saving Groq STT API key:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-openai-stt-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setOpenAiSttApiKey(apiKey);
      return { success: true };
    } catch (error: any) {
      console.error("Error saving OpenAI STT API key:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-deepgram-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setDeepgramApiKey(apiKey);
      return { success: true };
    } catch (error: any) {
      console.error("Error saving Deepgram API key:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-groq-stt-model", async (_, model: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setGroqSttModel(model);

      // Reconfigure the audio pipeline to use the new model
      await appState.reconfigureSttProvider();

      return { success: true };
    } catch (error: any) {
      console.error("Error setting Groq STT model:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-local-stt-model", async (_, model: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setLocalSttModel(model);

      // Reconfigure the audio pipeline to use the new local model on the next upload.
      await appState.reconfigureSttProvider();

      return { success: true };
    } catch (error: any) {
      console.error("Error setting local STT model:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-elevenlabs-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setElevenLabsApiKey(apiKey);
      return { success: true };
    } catch (error: any) {
      console.error("Error saving ElevenLabs API key:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-azure-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setAzureApiKey(apiKey);
      return { success: true };
    } catch (error: any) {
      console.error("Error saving Azure API key:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-azure-region", async (_, region: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setAzureRegion(region);

      // Reconfigure the pipeline since region changes the endpoint URL
      await appState.reconfigureSttProvider();

      return { success: true };
    } catch (error: any) {
      console.error("Error setting Azure region:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-ibmwatson-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setIbmWatsonApiKey(apiKey);
      return { success: true };
    } catch (error: any) {
      console.error("Error saving IBM Watson API key:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-soniox-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setSonioxApiKey(apiKey);
      return { success: true };
    } catch (error: any) {
      console.error("Error saving Soniox API key:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("test-deepgram-transcription", async (_, apiKey: string, audioBase64: string, mimeType: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const key = String(apiKey || CredentialsManager.getInstance().getDeepgramApiKey() || '').trim();
      if (!key) return { success: false, error: 'Add your Deepgram API key first.' };
      if (!audioBase64) return { success: false, error: 'No microphone audio was captured. Try again and speak for a few seconds.' };

      const WebSocket = require('ws');
      const audioBuffer = Buffer.from(audioBase64, 'base64');
      const model = process.env.DEEPGRAM_STT_MODEL?.trim() || 'flux-general-en';
      const isContainerized = /webm|ogg|wav/i.test(String(mimeType || ''));
      const url = isContainerized
        ? `wss://api.deepgram.com/v2/listen?model=${encodeURIComponent(model)}`
        : `wss://api.deepgram.com/v2/listen?model=${encodeURIComponent(model)}&encoding=linear16&sample_rate=16000`;

      return await new Promise<{ success: boolean; transcript?: string; error?: string }>((resolve) => {
        let settled = false;
        let transcript = '';
        let ws: any;

        const finish = (result: { success: boolean; transcript?: string; error?: string }) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          try { ws.close(); } catch { }
          resolve(result);
        };

        ws = new WebSocket(url, {
          headers: { Authorization: `Token ${key}` },
        });

        const timeout = setTimeout(() => {
          finish({ success: false, error: 'Deepgram did not return a transcript. Check your mic and try again.' });
        }, 15000);

        ws.on('open', () => {
          try {
            ws.send(audioBuffer);
            setTimeout(() => {
              try { ws.send(JSON.stringify({ type: 'CloseStream' })); } catch { }
            }, 250);
          } catch (err: any) {
            finish({ success: false, error: err?.message || 'Failed to send microphone audio to Deepgram.' });
          }
        });

        ws.on('message', (data: any) => {
          try {
            const msg = JSON.parse(data.toString());
            const text = typeof msg.transcript === 'string'
              ? msg.transcript
              : msg.channel?.alternatives?.[0]?.transcript;
            if (text?.trim()) {
              transcript = text.trim();
            }
            if ((msg.type === 'TurnInfo' && msg.event === 'EndOfTurn' && transcript) || msg.type === 'Metadata') {
              finish({ success: true, transcript });
            }
          } catch {
            // Ignore non-JSON frames.
          }
        });

        ws.on('unexpected-response', (_request: any, response: any) => {
          if (settled) return;
          clearTimeout(timeout);

          let body = '';
          response.on('data', (chunk: Buffer) => {
            body += chunk.toString('utf8');
          });
          response.on('end', () => {
            const detail = body.trim();
            finish({
              success: false,
              error: detail
                ? `Deepgram rejected the mic test (${response.statusCode}): ${detail}`
                : `Deepgram rejected the mic test (${response.statusCode}). Check key permissions or Flux access.`,
            });
          });
          response.on('error', () => {
            finish({ success: false, error: `Deepgram rejected the mic test (${response.statusCode}). Check key permissions or Flux access.` });
          });
        });

        ws.on('error', (err: any) => {
          finish({ success: false, error: err?.message || 'Deepgram connection failed.' });
        });

        ws.on('close', () => {
          if (settled) return;
          if (transcript) {
            finish({ success: true, transcript });
          } else {
            finish({ success: false, error: 'No transcript detected. Check your microphone and speak during the 3-second test.' });
          }
        });
      });
    } catch (error: any) {
      return { success: false, error: error?.message || 'Deepgram transcription test failed.' };
    }
  });

  // Helper to sanitize error messages (remove API key references)
  const sanitizeErrorMessage = (msg: string): string => {
    // Remove patterns like ": sk-***...***" or ": sdasdada***...dwwC"
    return msg.replace(/:\s*[a-zA-Z0-9*]+\*+[a-zA-Z0-9*]+\.?$/g, '').trim();
  };

  safeHandle("test-stt-connection", async (_, provider: 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox' | 'local-whisper', apiKey: string, region?: string) => {
    console.log(`[IPC] Received test - stt - connection request for provider: ${provider} `);
    try {
      if (provider === 'deepgram') {
        // Test Deepgram via WebSocket connection
        const WebSocket = require('ws');
        return await new Promise<{ success: boolean; error?: string }>((resolve) => {
          const model = process.env.DEEPGRAM_STT_MODEL?.trim() || 'flux-general-en';
          const url = `wss://api.deepgram.com/v2/listen?model=${encodeURIComponent(model)}&encoding=linear16&sample_rate=16000`;
          const ws = new WebSocket(url, {
            headers: { Authorization: `Token ${apiKey}` },
          });
          let settled = false;

          const timeout = setTimeout(() => {
            if (settled) return;
            settled = true;
            ws.close();
            resolve({ success: false, error: 'Connection timed out' });
          }, 15000);

          ws.on('open', () => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            try { ws.send(JSON.stringify({ type: 'CloseStream' })); } catch { }
            ws.close();
            resolve({ success: true });
          });

          ws.on('error', (err: any) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            resolve({ success: false, error: err.message || 'Connection failed' });
          });

          ws.on('unexpected-response', (_request: any, response: any) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);

            let body = '';
            response.on('data', (chunk: Buffer) => {
              body += chunk.toString('utf8');
            });
            response.on('end', () => {
              const detail = body.trim();
              resolve({
                success: false,
                error: detail
                  ? `Deepgram rejected the connection (${response.statusCode}): ${detail}`
                  : `Deepgram rejected the connection (${response.statusCode})`,
              });
            });
            response.on('error', () => {
              resolve({ success: false, error: `Deepgram rejected the connection (${response.statusCode})` });
            });
          });

          ws.on('close', (code: number, reason: Buffer) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            const detail = reason?.toString()?.trim();
            resolve({
              success: false,
              error: detail ? `Deepgram closed connection (${code}): ${detail}` : `Deepgram closed connection (${code})`,
            });
          });
        });
      }

      if (provider === 'soniox') {
        // Test Soniox via WebSocket connection
        const WebSocket = require('ws');
        return await new Promise<{ success: boolean; error?: string }>((resolve) => {
          const ws = new WebSocket('wss://stt-rt.soniox.com/transcribe-websocket');

          const timeout = setTimeout(() => {
            ws.close();
            resolve({ success: false, error: 'Connection timed out' });
          }, 15000);

          ws.on('open', () => {
            // Send a minimal config to validate the API key
            ws.send(JSON.stringify({
              api_key: apiKey,
              model: 'stt-rt-v4',
              audio_format: 'pcm_s16le',
              sample_rate: 16000,
              num_channels: 1,
            }));
          });

          ws.on('message', (msg: any) => {
            clearTimeout(timeout);
            try {
              const res = JSON.parse(msg.toString());
              if (res.error_code) {
                resolve({ success: false, error: `${res.error_code}: ${res.error_message}` });
              } else {
                resolve({ success: true });
              }
            } catch {
              resolve({ success: true });
            }
            ws.close();
          });

          ws.on('error', (err: any) => {
            clearTimeout(timeout);
            resolve({ success: false, error: err.message || 'Connection failed' });
          });
        });
      }

      const axios = require('axios');
      const FormData = require('form-data');

      // Generate a tiny silent WAV (0.5s of silence at 16kHz mono 16-bit)
      const numSamples = 8000;
      const pcmData = Buffer.alloc(numSamples * 2);
      const wavHeader = Buffer.alloc(44);
      wavHeader.write('RIFF', 0);
      wavHeader.writeUInt32LE(36 + pcmData.length, 4);
      wavHeader.write('WAVE', 8);
      wavHeader.write('fmt ', 12);
      wavHeader.writeUInt32LE(16, 16);
      wavHeader.writeUInt16LE(1, 20);
      wavHeader.writeUInt16LE(1, 22);
      wavHeader.writeUInt32LE(16000, 24);
      wavHeader.writeUInt32LE(32000, 28);
      wavHeader.writeUInt16LE(2, 32);
      wavHeader.writeUInt16LE(16, 34);
      wavHeader.write('data', 36);
      wavHeader.writeUInt32LE(pcmData.length, 40);
      const testWav = Buffer.concat([wavHeader, pcmData]);

      if (provider === 'local-whisper') {
        const ensure = await WhisperCppManager.getInstance().ensureRunning('stt-test-connection');
        if (!ensure.success) {
          return { success: false, error: ensure.error || 'Failed to start local whisper.cpp server' };
        }

        const endpoint =
          process.env.WHISPERCPP_ENDPOINT?.trim()
          || 'http://127.0.0.1:8000/v1/audio/transcriptions';
        const form = new FormData();
        form.append('file', testWav, { filename: 'test.wav', contentType: 'audio/wav' });
        const { CredentialsManager } = require('./services/CredentialsManager');
        form.append('model', CredentialsManager.getInstance().getLocalSttModel());

        await axios.post(endpoint, form, {
          headers: {
            ...form.getHeaders(),
          },
          timeout: 120000,
        });

        return { success: true };
      }

      if (provider === 'elevenlabs') {
        // ElevenLabs: Use /v1/voices to validate the API key (minimal scope required).
        // Scoped keys may lack speech_to_text or user_read but still be usable once permissions are added.
        try {
          await axios.get('https://api.elevenlabs.io/v1/voices', {
            headers: { 'xi-api-key': apiKey },
            timeout: 10000,
          });
        } catch (elErr: any) {
          const elStatus = elErr?.response?.data?.detail?.status;
          // If the error is "invalid_api_key", the key itself is wrong â€” fail.
          // Any other error (missing permission, etc.) means the key IS valid, just possibly scoped.
          if (elStatus === 'invalid_api_key') {
            throw elErr;
          }
          // Key is valid but scoped â€” pass with a warning
          console.log('[IPC] ElevenLabs key is valid but may have restricted scopes. Saving key.');
        }
      } else if (provider === 'azure') {
        // Azure: raw binary with subscription key
        const azureRegion = region || 'eastus';
        await axios.post(
          `https://${azureRegion}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US`,
          testWav,
          {
            headers: { 'Ocp-Apim-Subscription-Key': apiKey, 'Content-Type': 'audio/wav' },
            timeout: 15000,
          }
        );
      } else if (provider === 'ibmwatson') {
        // IBM Watson: raw binary with Basic auth
        const ibmRegion = region || 'us-south';
        await axios.post(
          `https://api.${ibmRegion}.speech-to-text.watson.cloud.ibm.com/v1/recognize`,
          testWav,
          {
            headers: {
              Authorization: `Basic ${Buffer.from(`apikey:${apiKey}`).toString('base64')}`,
              'Content-Type': 'audio/wav',
            },
            timeout: 15000,
          }
        );
      } else {
        // Groq / OpenAI: multipart FormData
        const endpoint = provider === 'groq'
          ? 'https://api.groq.com/openai/v1/audio/transcriptions'
          : 'https://api.openai.com/v1/audio/transcriptions';
        const model = provider === 'groq' ? 'whisper-large-v3-turbo' : 'whisper-1';

        const form = new FormData();
        form.append('file', testWav, { filename: 'test.wav', contentType: 'audio/wav' });
        form.append('model', model);

        await axios.post(endpoint, form, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            ...form.getHeaders(),
          },
          timeout: 15000,
        });
      }

      return { success: true };
    } catch (error: any) {
      const respData = error?.response?.data;
      const rawMsg = respData?.error?.message || respData?.detail?.message || respData?.message || error.message || 'Connection failed';
      const msg = sanitizeErrorMessage(rawMsg);
      console.error("STT connection test failed:", msg);
      return { success: false, error: msg };
    }
  });

  safeHandle("test-llm-connection", async (_, provider: 'gemini' | 'groq' | 'openai' | 'claude', apiKey?: string) => {
    console.log(`[IPC] Received test-llm-connection request for provider: ${provider}`);
    try {
      if (!apiKey || !apiKey.trim()) {
        const { CredentialsManager } = require('./services/CredentialsManager');
        const creds = CredentialsManager.getInstance();
        if (provider === 'gemini') apiKey = creds.getGeminiApiKey();
        else if (provider === 'groq') apiKey = creds.getGroqApiKey();
        else if (provider === 'openai') apiKey = creds.getOpenaiApiKey();
        else if (provider === 'claude') apiKey = creds.getClaudeApiKey();
      }

      if (!apiKey || !apiKey.trim()) {
        return { success: false, error: 'No API key provided' };
      }

      const axios = require('axios');
      let response;

      if (provider === 'gemini') {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent`;
        response = await axios.post(url, {
          contents: [{ parts: [{ text: "Hello" }] }]
        }, {
          headers: { 'x-goog-api-key': apiKey },
          timeout: 15000
        });
      } else if (provider === 'groq') {
        response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
          model: "llama-3.3-70b-versatile",
          messages: [{ role: "user", content: "Hello" }]
        }, {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: 15000
        });
      } else if (provider === 'openai') {
        response = await axios.post('https://api.openai.com/v1/chat/completions', {
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "Hello" }]
        }, {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: 15000
        });
      } else if (provider === 'claude') {
        response = await axios.post('https://api.anthropic.com/v1/messages', {
          model: "claude-sonnet-4-6",
          max_tokens: 10,
          messages: [{ role: "user", content: "Hello" }]
        }, {
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
          },
          timeout: 15000
        });
      }

      if (response && (response.status === 200 || response.status === 201)) {
        return { success: true };
      } else {
        return { success: false, error: 'Request failed with status ' + response?.status };
      }

    } catch (error: any) {
      console.error("LLM connection test failed:", error);
      const rawMsg = error?.response?.data?.error?.message || error?.response?.data?.message || (error.response?.data?.error?.type ? `${error.response.data.error.type}: ${error.response.data.error.message}` : error.message) || 'Connection failed';
      const msg = sanitizeErrorMessage(rawMsg);
      return { success: false, error: msg };
    }
  });

  safeHandle("get-groq-fast-text-mode", () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      return { enabled: llmHelper.getGroqFastTextMode() };
    } catch (error: any) {
      return { enabled: false };
    }
  });

  // Set Groq Fast Text Mode
  safeHandle("set-groq-fast-text-mode", (_, enabled: boolean) => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      llmHelper.setGroqFastTextMode(enabled);

      const { SettingsManager } = require('./services/SettingsManager');
      SettingsManager.getInstance().set('groqFastTextMode', enabled);

      // Broadcast to all windows
      BrowserWindow.getAllWindows().forEach(win => {
        win.webContents.send('groq-fast-text-changed', enabled);
      });

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-model", async (_, modelId: string) => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      const { CredentialsManager } = require('./services/CredentialsManager');
      const cm = CredentialsManager.getInstance();

      // Get all providers (Curl + Custom)
      const curlProviders = cm.getCurlProviders();
      const legacyProviders = cm.getCustomProviders() || [];
      const allProviders = [...curlProviders, ...legacyProviders];

      llmHelper.setModel(modelId, allProviders);

      // Close the selector window if open
      appState.modelSelectorWindowHelper.hideWindow();

      // Broadcast to all windows so NativelyInterface can update its selector (session-only update)
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) {
          win.webContents.send('model-changed', modelId);
        }
      });

      return { success: true };
    } catch (error: any) {
      console.error("Error setting model:", error);
      return { success: false, error: error.message };
    }
  });

  // Persist default model (from Settings) + update runtime + broadcast to all windows
  safeHandle("set-default-model", async (_, modelId: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const cm = CredentialsManager.getInstance();
      cm.setDefaultModel(modelId);

      // Also update the runtime model
      const llmHelper = appState.processingHelper.getLLMHelper();
      const curlProviders = cm.getCurlProviders();
      const legacyProviders = cm.getCustomProviders() || [];
      const allProviders = [...curlProviders, ...legacyProviders];
      llmHelper.setModel(modelId, allProviders);

      // Close the selector window if open
      appState.modelSelectorWindowHelper.hideWindow();

      // Broadcast to all windows so NativelyInterface can update its selector
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) {
          win.webContents.send('model-changed', modelId);
        }
      });

      return { success: true };
    } catch (error: any) {
      console.error("Error setting default model:", error);
      return { success: false, error: error.message };
    }
  });

  // Read the persisted default model
  safeHandle("get-default-model", async () => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const cm = CredentialsManager.getInstance();
      return { model: cm.getDefaultModel() };
    } catch (error: any) {
      console.error("Error getting default model:", error);
      return { model: 'gemini-3.1-flash-lite-preview' };
    }
  });

  // --- Model Selector Window IPC ---

  safeHandle("show-model-selector", (_, coords: { x: number; y: number }) => {
    appState.modelSelectorWindowHelper.showWindow(coords.x, coords.y);
  });

  safeHandle("hide-model-selector", () => {
    appState.modelSelectorWindowHelper.hideWindow();
  });

  safeHandle("toggle-model-selector", (_, coords: { x: number; y: number }) => {
    appState.modelSelectorWindowHelper.toggleWindow(coords.x, coords.y);
  });



  // Native Audio Service Handlers
  // Native Audio handlers removed as part of migration to driverless architecture
  safeHandle("native-audio-status", async () => {
    // Always return true or pseudo-status since it's "driverless"
    return { connected: true };
  });

  safeHandle("get-input-devices", async () => {
    return AudioDevices.getInputDevices();
  });

  safeHandle("get-output-devices", async () => {
    return AudioDevices.getOutputDevices();
  });

  safeHandle("start-audio-test", async (event, deviceId?: string) => {
    await appState.startAudioTest(deviceId);
    return { success: true };
  });

  safeHandle("stop-audio-test", async () => {
    appState.stopAudioTest();
    return { success: true };
  });

  safeHandle("set-recognition-language", async (_, key: string) => {
    appState.setRecognitionLanguage(key);
    return { success: true };
  });

  // ==========================================
  // Meeting Lifecycle Handlers
  // ==========================================

  safeHandle("start-meeting", async (event, metadata?: any) => {
    try {
      await appState.startMeeting(metadata);
      return { success: true };
    } catch (error: any) {
      console.error("Error starting meeting:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("end-meeting", async () => {
    try {
      await appState.endMeeting();
      return { success: true };
    } catch (error: any) {
      console.error("Error ending meeting:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("get-recent-meetings", async () => {
    // Fetch from SQLite (limit 50)
    return DatabaseManager.getInstance().getRecentMeetings(50);
  });

  safeHandle("get-meeting-details", async (event, id) => {
    // Helper to fetch full details
    return DatabaseManager.getInstance().getMeetingDetails(id);
  });

  safeHandle("update-meeting-title", async (_, { id, title }: { id: string; title: string }) => {
    return DatabaseManager.getInstance().updateMeetingTitle(id, title);
  });

  safeHandle("update-meeting-summary", async (_, { id, updates }: { id: string; updates: any }) => {
    return DatabaseManager.getInstance().updateMeetingSummary(id, updates);
  });

  safeHandle("seed-demo", async () => {
    DatabaseManager.getInstance().seedDemoMeeting();

    // Ensure RAG embeddings exist for the demo meeting.
    // Use ensureDemoMeetingProcessed so we skip if already embedded
    // (avoids re-clearing 14 queue items on every app launch once processed).
    const ragManager = appState.getRAGManager();
    if (ragManager && ragManager.isReady()) {
      ragManager.ensureDemoMeetingProcessed().catch(console.error);
    }

    return { success: true };
  });

  safeHandle("flush-database", async () => {
    const result = DatabaseManager.getInstance().clearAllData();
    return { success: result };
  });

  safeHandle("open-external", async (event, url: string) => {
    try {
      const parsed = new URL(url);
      if (['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
        await shell.openExternal(url);
      } else {
        console.warn(`[IPC] Blocked potentially unsafe open-external: ${url}`);
      }
    } catch {
      console.warn(`[IPC] Invalid URL in open-external: ${url}`);
    }
  });

  // Opens macOS System Settings > Privacy & Security > Screen Recording.
  // Separate from open-external because that handler only allows http/https/mailto.
  safeHandle("open-screen-recording-settings", async () => {
    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
  });

  safeHandle("open-microphone-settings", async () => {
    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone');
  });

  // Current macOS permission status, for the first-run permissions screen.
  safeHandle("get-permissions-status", async () => {
    if (process.platform !== 'darwin') return { microphone: 'granted', screenRecording: 'granted' };
    return {
      microphone: systemPreferences.getMediaAccessStatus('microphone'),
      screenRecording: systemPreferences.getMediaAccessStatus('screen'),
    };
  });

  // Trigger the macOS microphone permission prompt. No-op if already granted or non-mac.
  safeHandle("request-microphone-permission", async () => {
    if (process.platform !== 'darwin') return { granted: true };
    if (systemPreferences.getMediaAccessStatus('microphone') === 'granted') return { granted: true };
    try {
      const granted = await systemPreferences.askForMediaAccess('microphone');
      return { granted };
    } catch {
      return { granted: false };
    }
  });

  // macOS has no askForMediaAccess('screen'). Touching a screen-capture API triggers the
  // first-time prompt; after that the user grants it in System Settings, so open that pane.
  safeHandle("request-screen-recording-permission", async () => {
    if (process.platform !== 'darwin') return { status: 'granted' };
    try { await desktopCapturer.getSources({ types: ['screen'] }); } catch { /* ignore */ }
    const status = systemPreferences.getMediaAccessStatus('screen');
    if (status !== 'granted') {
      await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
    }
    return { status };
  });

  // ==========================================
  // Intelligence Mode Handlers
  // ==========================================

  // MODE 1: Assist (Passive observation)
  safeHandle("generate-assist", async () => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const insight = await intelligenceManager.runAssistMode();
      return { insight };
    } catch (error: any) {
      throw error;
    }
  });

  // MODE 2: What Should I Say (Primary auto-answer)
  safeHandle("generate-what-to-say", async (_, question?: string, imagePaths?: string[]) => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      // Question and imagePaths are now optional - IntelligenceManager infers from transcript
      const answer = await intelligenceManager.runWhatShouldISay(question, 0.8, imagePaths);
      return { answer, question: question || 'inferred from context' };
    } catch (error: any) {
      // Return graceful fallback instead of throwing
      return {
        question: question || 'unknown'
      };
    }
  });

  safeHandle("generate-clarify", async () => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const clarification = await intelligenceManager.runClarify();
      // If null returned without throwing, the engine already set mode to idle.
      // We must still ensure the frontend un-sticks â€” emit an error so onIntelligenceError fires.
      if (clarification === null) {
        const win = appState.getMainWindow();
        win?.webContents.send('intelligence-error', { error: 'Could not generate a clarifying question. Try again after some audio context is available.', mode: 'clarify' });
      }
      return { clarification };
    } catch (error: any) {
      throw error;
    }
  });

  safeHandle("generate-code-hint", async (_, imagePaths?: string[], problemStatement?: string) => {
    try {
      // If no explicit images were passed from the frontend, fall back to the
      // screenshot queue so the AI can always "see" the user's screen.
      const resolvedImagePaths: string[] =
        imagePaths && imagePaths.length > 0
          ? imagePaths
          : appState.getScreenshotQueue();

      console.log(`[IPC] generate-code-hint: using ${resolvedImagePaths.length} image(s) (${imagePaths?.length ? 'explicit' : 'queue fallback'})`);

      const intelligenceManager = appState.getIntelligenceManager();
      const hint = await intelligenceManager.runCodeHint(
        resolvedImagePaths.length > 0 ? resolvedImagePaths : undefined,
        problemStatement
      );
      return { hint };
    } catch (error: any) {
      throw error;
    }
  });

  safeHandle("generate-brainstorm", async (_, imagePaths?: string[], problemStatement?: string) => {
    try {
      // If no explicit images were passed from the frontend, fall back to the
      // screenshot queue so the AI can always "see" the user's screen.
      const resolvedImagePaths: string[] =
        imagePaths && imagePaths.length > 0
          ? imagePaths
          : appState.getScreenshotQueue();

      console.log(`[IPC] generate-brainstorm: using ${resolvedImagePaths.length} image(s) (${imagePaths?.length ? 'explicit' : 'queue fallback'})`);

      const intelligenceManager = appState.getIntelligenceManager();
      const script = await intelligenceManager.runBrainstorm(
        resolvedImagePaths.length > 0 ? resolvedImagePaths : undefined,
        problemStatement
      );
      return { script };
    } catch (error: any) {
      throw error;
    }
  });

  // Dynamic Action Button Mode (Recap vs Brainstorm)
  safeHandle("get-action-button-mode", () => {
    const { SettingsManager } = require('./services/SettingsManager');
    const sm = SettingsManager.getInstance();
    return sm.get('actionButtonMode') ?? 'recap';
  });

  safeHandle("set-action-button-mode", (_, mode: 'recap' | 'brainstorm') => {
    const { SettingsManager } = require('./services/SettingsManager');
    const sm = SettingsManager.getInstance();
    sm.set('actionButtonMode', mode);

    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) {
        win.webContents.send('action-button-mode-changed', mode);
      }
    });

    return { success: true };
  });

  // MODE 3: Follow-Up (Refinement)
  safeHandle("generate-follow-up", async (_, intent: string, userRequest?: string) => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const refined = await intelligenceManager.runFollowUp(intent, userRequest);
      return { refined, intent };
    } catch (error: any) {
      throw error;
    }
  });

  // MODE 4: Recap (Summary)
  safeHandle("generate-recap", async () => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const summary = await intelligenceManager.runRecap();
      return { summary };
    } catch (error: any) {
      throw error;
    }
  });

  // MODE 6: Follow-Up Questions
  safeHandle("generate-follow-up-questions", async () => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const questions = await intelligenceManager.runFollowUpQuestions();
      return { questions };
    } catch (error: any) {
      throw error;
    }
  });

  // MODE 5: Manual Answer (Fallback)
  safeHandle("submit-manual-question", async (_, question: string) => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const answer = await intelligenceManager.runManualAnswer(question);
      return { answer, question };
    } catch (error: any) {
      throw error;
    }
  });

  // Get current intelligence context
  safeHandle("get-intelligence-context", async () => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      return {
        context: intelligenceManager.getFormattedContext(),
        lastAssistantMessage: intelligenceManager.getLastAssistantMessage(),
        activeMode: intelligenceManager.getActiveMode()
      };
    } catch (error: any) {
      throw error;
    }
  });

  // Reset intelligence state
  safeHandle("reset-intelligence", async () => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      intelligenceManager.reset();
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });


  // Service Account Selection
  safeHandle("select-service-account", async () => {
    try {
      const result: any = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }]
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, cancelled: true };
      }

      const filePath = result.filePaths[0];

      // Update backend state immediately
      appState.updateGoogleCredentials(filePath);

      // Persist the path for future sessions
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setGoogleServiceAccountPath(filePath);

      return { success: true, path: filePath };
    } catch (error: any) {
      console.error("Error selecting service account:", error);
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // Theme System Handlers
  // ==========================================

  safeHandle("theme:get-mode", () => {
    const tm = appState.getThemeManager();
    return {
      mode: tm.getMode(),
      resolved: tm.getResolvedTheme()
    };
  });

  safeHandle("theme:set-mode", (_, mode: 'system' | 'light' | 'dark') => {
    appState.getThemeManager().setMode(mode);
    return { success: true };
  });

  // ==========================================
  // Calendar Integration Handlers
  // ==========================================

  safeHandle("calendar-connect", async () => {
    try {
      const { CalendarManager } = require('./services/CalendarManager');
      await CalendarManager.getInstance().startAuthFlow();
      return { success: true };
    } catch (error: any) {
      console.error("Calendar auth error:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("calendar-disconnect", async () => {
    const { CalendarManager } = require('./services/CalendarManager');
    await CalendarManager.getInstance().disconnect();
    return { success: true };
  });

  safeHandle("get-calendar-status", async () => {
    const { CalendarManager } = require('./services/CalendarManager');
    return CalendarManager.getInstance().getConnectionStatus();
  });

  safeHandle("get-upcoming-events", async () => {
    const { CalendarManager } = require('./services/CalendarManager');
    return CalendarManager.getInstance().getUpcomingEvents();
  });

  safeHandle("calendar-refresh", async () => {
    const { CalendarManager } = require('./services/CalendarManager');
    await CalendarManager.getInstance().refreshState();
    return { success: true };
  });

  // ==========================================
  // Follow-up Email Handlers
  // ==========================================

  safeHandle("generate-followup-email", async (_, input: any) => {
    try {
      const { FOLLOWUP_EMAIL_PROMPT, GROQ_FOLLOWUP_EMAIL_PROMPT } = require('./llm/prompts');
      const { buildFollowUpEmailPromptInput } = require('./utils/emailUtils');

      const llmHelper = appState.processingHelper.getLLMHelper();

      // Build the context string from input
      const contextString = buildFollowUpEmailPromptInput(input);

      // Build prompts
      const geminiPrompt = `${FOLLOWUP_EMAIL_PROMPT}\n\nMEETING DETAILS:\n${contextString}`;
      const groqPrompt = `${GROQ_FOLLOWUP_EMAIL_PROMPT}\n\nMEETING DETAILS:\n${contextString}`;

      // Use chatWithGemini with alternateGroqMessage for fallback
      const emailBody = await llmHelper.chatWithGemini(geminiPrompt, undefined, undefined, true, groqPrompt);

      return emailBody;
    } catch (error: any) {
      console.error("Error generating follow-up email:", error);
      throw error;
    }
  });

  safeHandle("extract-emails-from-transcript", async (_, transcript: Array<{ text: string }>) => {
    try {
      const { extractEmailsFromTranscript } = require('./utils/emailUtils');
      return extractEmailsFromTranscript(transcript);
    } catch (error: any) {
      console.error("Error extracting emails:", error);
      return [];
    }
  });

  safeHandle("get-calendar-attendees", async (_, eventId: string) => {
    try {
      const { CalendarManager } = require('./services/CalendarManager');
      const cm = CalendarManager.getInstance();

      // Try to get attendees from the event
      const events = await cm.getUpcomingEvents();
      const event = events?.find((e: any) => e.id === eventId);

      if (event && event.attendees) {
        return event.attendees.map((a: any) => ({
          email: a.email,
          name: a.displayName || a.email?.split('@')[0] || ''
        })).filter((a: any) => a.email);
      }

      return [];
    } catch (error: any) {
      console.error("Error getting calendar attendees:", error);
      return [];
    }
  });

  safeHandle("open-mailto", async (_, { to, subject, body }: { to: string; subject: string; body: string }) => {
    try {
      const { buildMailtoLink } = require('./utils/emailUtils');
      const mailtoUrl = buildMailtoLink(to, subject, body);
      await shell.openExternal(mailtoUrl);
      return { success: true };
    } catch (error: any) {
      console.error("Error opening mailto:", error);
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // RAG (Retrieval-Augmented Generation) Handlers
  // ==========================================

  // Store active query abort controllers for cancellation
  const activeRAGQueries = new Map<string, AbortController>();

  // Query meeting with RAG (meeting-scoped)
  safeHandle("rag:query-meeting", async (event, { meetingId, query }: { meetingId: string; query: string }) => {
    const ragManager = appState.getRAGManager();

    if (!ragManager || !ragManager.isReady()) {
      // Fallback to regular chat if RAG not available
      console.log("[RAG] Not ready, falling back to regular chat");
      return { fallback: true };
    }

    // For completed meetings, check if post-meeting RAG is processed.
    // For live meetings with JIT indexing, let RAGManager.queryMeeting() decide.
    if (!ragManager.isMeetingProcessed(meetingId) && !ragManager.isLiveIndexingActive(meetingId)) {
      console.log(`[RAG] Meeting ${meetingId} not processed and no JIT indexing, falling back to regular chat`);
      return { fallback: true };
    }

    const abortController = new AbortController();
    const queryKey = `meeting-${meetingId}`;
    activeRAGQueries.set(queryKey, abortController);

    try {
      const stream = ragManager.queryMeeting(meetingId, query, abortController.signal);

      for await (const chunk of stream) {
        if (abortController.signal.aborted) break;
        event.sender.send("rag:stream-chunk", { meetingId, chunk });
      }

      event.sender.send("rag:stream-complete", { meetingId });
      return { success: true };

    } catch (error: any) {
      if (error.name !== 'AbortError') {
        const msg = error.message || "";
        // If specific RAG failures, return fallback to use transcript window
        if (msg.includes('NO_RELEVANT_CONTEXT') || msg.includes('NO_MEETING_EMBEDDINGS')) {
          console.log(`[RAG] Query failed with '${msg}', falling back to regular chat`);
          return { fallback: true };
        }

        console.error("[RAG] Query error:", error);
        event.sender.send("rag:stream-error", { meetingId, error: msg });
      }
      return { success: false, error: error.message };
    } finally {
      activeRAGQueries.delete(queryKey);
    }
  });

  // Query live meeting with JIT RAG
  safeHandle("rag:query-live", async (event, { query }: { query: string }) => {
    const ragManager = appState.getRAGManager();

    if (!ragManager || !ragManager.isReady()) {
      return { fallback: true };
    }

    // Check if JIT indexing is active and has chunks
    if (!ragManager.isLiveIndexingActive('live-meeting-current')) {
      return { fallback: true };
    }

    const abortController = new AbortController();
    const queryKey = `live-${Date.now()}`;
    activeRAGQueries.set(queryKey, abortController);

    try {
      const stream = ragManager.queryMeeting('live-meeting-current', query, abortController.signal);

      for await (const chunk of stream) {
        if (abortController.signal.aborted) break;
        event.sender.send("rag:stream-chunk", { live: true, chunk });
      }

      event.sender.send("rag:stream-complete", { live: true });
      return { success: true };

    } catch (error: any) {
      if (error.name !== 'AbortError') {
        const msg = error.message || "";
        // If JIT RAG failed (no embeddings yet, no relevant context), fallback to regular chat
        if (msg.includes('NO_RELEVANT_CONTEXT') || msg.includes('NO_MEETING_EMBEDDINGS')) {
          console.log(`[RAG] JIT query failed with '${msg}', falling back to regular live chat`);
          return { fallback: true };
        }
        console.error("[RAG] Live query error:", error);
        event.sender.send("rag:stream-error", { live: true, error: msg });
      }
      return { success: false, error: error.message };
    } finally {
      activeRAGQueries.delete(queryKey);
    }
  });

  // Query global (cross-meeting search)
  safeHandle("rag:query-global", async (event, { query }: { query: string }) => {
    const ragManager = appState.getRAGManager();

    if (!ragManager || !ragManager.isReady()) {
      return { fallback: true };
    }

    const abortController = new AbortController();
    const queryKey = `global-${Date.now()}`;
    activeRAGQueries.set(queryKey, abortController);

    try {
      const stream = ragManager.queryGlobal(query, abortController.signal);

      for await (const chunk of stream) {
        if (abortController.signal.aborted) break;
        event.sender.send("rag:stream-chunk", { global: true, chunk });
      }

      event.sender.send("rag:stream-complete", { global: true });
      return { success: true };

    } catch (error: any) {
      if (error.name !== 'AbortError') {
        event.sender.send("rag:stream-error", { global: true, error: error.message });
      }
      return { success: false, error: error.message };
    } finally {
      activeRAGQueries.delete(queryKey);
    }
  });

  // Cancel active RAG query
  safeHandle("rag:cancel-query", async (_, { meetingId, global }: { meetingId?: string; global?: boolean }) => {
    const queryKey = global ? 'global' : `meeting-${meetingId}`;

    // Cancel any matching key
    for (const [key, controller] of activeRAGQueries) {
      if (key.startsWith(queryKey) || (global && key.startsWith('global'))) {
        controller.abort();
        activeRAGQueries.delete(key);
      }
    }

    return { success: true };
  });

  // Check if meeting has RAG embeddings
  safeHandle('rag:is-meeting-processed', async (_, meetingId: string) => {
    try {
      const ragManager = appState.getRAGManager();
      if (!ragManager) throw new Error('RAGManager not initialized');
      return ragManager.isMeetingProcessed(meetingId);
    } catch (error: any) {
      console.error('[IPC rag:is-meeting-processed] Error:', error);
      return false;
    }
  });

  safeHandle('rag:reindex-incompatible-meetings', async () => {
    try {
      const ragManager = appState.getRAGManager();
      if (!ragManager) throw new Error('RAGManager not initialized');
      await ragManager.reindexIncompatibleMeetings();
      return { success: true };
    } catch (error: any) {
      console.error('[IPC rag:reindex-incompatible-meetings] Error:', error);
      return { success: false, error: error.message };
    }
  });

  // Get RAG queue status
  safeHandle("rag:get-queue-status", async () => {
    const ragManager = appState.getRAGManager();
    if (!ragManager) return { pending: 0, processing: 0, completed: 0, failed: 0 };
    return ragManager.getQueueStatus();
  });

  // Retry pending embeddings
  safeHandle("rag:retry-embeddings", async () => {
    const ragManager = appState.getRAGManager();
    if (!ragManager) return { success: false };
    await ragManager.retryPendingEmbeddings();
    return { success: true };
  });

  // ==========================================
  // Realtime Modes IPC Handlers
  // ==========================================

  const defaultRealtimeModesConfig = () => {
    const now = new Date().toISOString();
    return {
      modes: [
        {
          id: 'general',
          name: 'General',
          prompt: `You are my real-time interview copilot. Give concise, natural first-person responses that sound like a real person speaking live. Keep answers confident, specific, and practical.`,
          referenceFiles: [] as any[],
          createdAt: now,
          updatedAt: now,
        },
      ],
      activeModeId: 'general' as string | null,
    };
  };

  const normalizeRealtimeModesConfig = (rawConfig: any) => {
    const fallback = defaultRealtimeModesConfig();
    const sourceModes = Array.isArray(rawConfig?.modes) ? rawConfig.modes : fallback.modes;
    const now = new Date().toISOString();

    const seen = new Set<string>();
    const modes = sourceModes
      .map((raw: any, index: number) => {
        const idBase = String(raw?.id || '').trim() || `mode-${index + 1}`;
        const id = seen.has(idBase) ? `${idBase}-${index + 1}` : idBase;
        seen.add(id);

        const prompt = String(raw?.prompt || '').trim();
        if (!prompt) return null;

        const referenceFiles = Array.isArray(raw?.referenceFiles)
          ? raw.referenceFiles
              .map((file: any) => ({
                id: String(file?.id || '').trim() || `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                name: String(file?.name || '').trim() || 'Reference file',
                size: Number.isFinite(Number(file?.size)) ? Number(file.size) : 0,
                storedPath: typeof file?.storedPath === 'string' ? file.storedPath : undefined,
                text: typeof file?.text === 'string' ? file.text.slice(0, 12000) : '',
                uploadedAt: String(file?.uploadedAt || '').trim() || now,
              }))
              .filter((file: any) => file.name)
          : [];

        return {
          id,
          name: String(raw?.name || '').trim() || `Mode ${index + 1}`,
          prompt,
          referenceFiles,
          createdAt: String(raw?.createdAt || '').trim() || now,
          updatedAt: now,
        };
      })
      .filter(Boolean) as Array<{ id: string; name: string; prompt: string; createdAt: string; updatedAt: string }>;

    const finalModes = modes.length > 0 ? modes : fallback.modes;
    const requestedActiveId = typeof rawConfig?.activeModeId === 'string' ? rawConfig.activeModeId : null;
    const activeModeId = requestedActiveId && finalModes.some((m) => m.id === requestedActiveId)
      ? requestedActiveId
      : finalModes[0].id;

    return { modes: finalModes, activeModeId };
  };

  const applyRealtimeModesToRuntime = (config: { modes: any[]; activeModeId: string | null }) => {
    try {
      const llmHelper = appState.processingHelper?.getLLMHelper?.();
      if (llmHelper && typeof llmHelper.setRealtimeModes === 'function') {
        llmHelper.setRealtimeModes(config.modes, config.activeModeId);
      }
    } catch (error) {
      console.error('[IPC] Failed applying realtime modes to runtime:', error);
    }
  };

  safeHandle("modes:get-config", async () => {
    try {
      const { SettingsManager } = require('./services/SettingsManager');
      const sm = SettingsManager.getInstance();
      const normalized = normalizeRealtimeModesConfig(sm.get('modesConfig'));
      sm.set('modesConfig', normalized);
      applyRealtimeModesToRuntime(normalized);
      return normalized;
    } catch (error: any) {
      console.error('[IPC] modes:get-config error:', error);
      const fallback = defaultRealtimeModesConfig();
      applyRealtimeModesToRuntime(fallback);
      return fallback;
    }
  });

  safeHandle("modes:save-config", async (_, rawConfig: any) => {
    try {
      const { SettingsManager } = require('./services/SettingsManager');
      const sm = SettingsManager.getInstance();
      const normalized = normalizeRealtimeModesConfig(rawConfig);
      sm.set('modesConfig', normalized);
      applyRealtimeModesToRuntime(normalized);
      return { success: true, config: normalized };
    } catch (error: any) {
      console.error('[IPC] modes:save-config error:', error);
      return { success: false, error: error.message };
    }
  });

  const extractModeReferenceText = async (filePath: string, ext: string): Promise<string> => {
    try {
      const lowerExt = ext.toLowerCase();
      if (['.txt', '.md', '.markdown', '.csv', '.json', '.log', '.yaml', '.yml'].includes(lowerExt)) {
        return (await fs.promises.readFile(filePath, 'utf8')).slice(0, 12000);
      }

      if (lowerExt === '.pdf') {
        const pdfParse = require('pdf-parse');
        const buffer = await fs.promises.readFile(filePath);
        const result = await pdfParse(buffer);
        return String(result?.text || '').slice(0, 12000);
      }

      if (lowerExt === '.docx') {
        const mammoth = require('mammoth');
        const result = await mammoth.extractRawText({ path: filePath });
        return String(result?.value || '').slice(0, 12000);
      }
    } catch (error: any) {
      console.warn(`[IPC] modes:upload-reference-files text extraction failed for ${filePath}:`, error?.message || error);
    }

    return '';
  };

  safeHandle("modes:upload-reference-files", async () => {
    try {
      const owner = appState.settingsWindowHelper?.getSettingsWindow?.() || appState.getMainWindow?.();
      const dialogOptions: OpenDialogOptions = {
        title: 'Upload mode reference files',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'Documents', extensions: ['pdf', 'docx', 'txt', 'md', 'markdown', 'csv', 'json', 'log', 'yaml', 'yml'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      };
      const result: any = owner
        ? await dialog.showOpenDialog(owner, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions);

      if (result.canceled || result.filePaths.length === 0) {
        return { success: true, cancelled: true, files: [] };
      }

      const storageDir = path.join(app.getPath('userData'), 'mode-reference-files');
      await fs.promises.mkdir(storageDir, { recursive: true });

      const uploadedFiles = [];
      for (const filePath of result.filePaths) {
        const stat = await fs.promises.stat(filePath);
        if (!stat.isFile()) continue;
        if (stat.size > 25 * 1024 * 1024) {
          console.warn(`[IPC] modes:upload-reference-files skipped oversized file: ${filePath}`);
          continue;
        }

        const originalName = path.basename(filePath);
        const ext = path.extname(originalName);
        const baseName = path.basename(originalName, ext).replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'reference-file';
        const id = `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const storedName = `${id}-${baseName}${ext}`;
        const storedPath = path.join(storageDir, storedName);

        await fs.promises.copyFile(filePath, storedPath);
        const text = await extractModeReferenceText(storedPath, ext);

        uploadedFiles.push({
          id,
          name: originalName,
          size: stat.size,
          storedPath,
          text,
          uploadedAt: new Date().toISOString(),
        });
      }

      return { success: true, cancelled: false, files: uploadedFiles };
    } catch (error: any) {
      console.error('[IPC] modes:upload-reference-files error:', error);
      return { success: false, error: error.message || 'Failed to upload reference files.' };
    }
  });

  // ==========================================
  // Overlay Opacity (Stealth Mode)
  // ==========================================

  safeHandle("set-overlay-opacity", async (_, opacity: number) => {
    const numericOpacity = Number(opacity);
    if (!Number.isFinite(numericOpacity)) return;
    // Clamp to valid range
    const clamped = Math.min(1.0, Math.max(0.35, numericOpacity));
    const windowHelper = appState.getWindowHelper();
    // No-op if value is unchanged (prevents renderer echo loops)
    if (Math.abs(windowHelper.getOverlayOpacity() - clamped) < 0.0001) return;

    windowHelper.setOverlayOpacity(clamped);
    const { SettingsManager } = require('./services/SettingsManager');
    SettingsManager.getInstance().set('overlayOpacity', clamped);

    // Broadcast to all renderer windows so the overlay picks it up in real-time
    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) {
        win.webContents.send('overlay-opacity-changed', clamped);
      }
    });
    return;
  });
}
