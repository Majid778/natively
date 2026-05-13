import { BrowserWindow, screen, app } from "electron"
import path from "node:path"

const isDev = process.env.NODE_ENV === "development"

const startUrl = isDev
    ? "http://localhost:5180"
    : `file://${path.join(app.getAppPath(), "dist/index.html")}`

const fallbackFileUrl = `file://${path.join(app.getAppPath(), "dist/index.html")}`;
const MODEL_SELECTOR_WIDTH = 300;
const MODEL_SELECTOR_HEIGHT = 220;

import type { WindowHelper } from "./WindowHelper"

type WindowActivationOptions = {
    activate?: boolean
}

export class ModelSelectorWindowHelper {
    private window: BrowserWindow | null = null
    private contentProtection: boolean = false
    private opacityTimeout: NodeJS.Timeout | null = null;

    // Store offsets relative to main window if needed, but absolute positioning is simpler for dropdowns
    private lastBlurTime: number = 0
    private ignoreBlur: boolean = false;

    constructor() { }

    public setIgnoreBlur(ignore: boolean): void {
        this.ignoreBlur = ignore;
    }

    private windowHelper: WindowHelper | null = null;

    public setWindowHelper(wh: WindowHelper): void {
        this.windowHelper = wh;
    }

    public getWindow(): BrowserWindow | null {
        return this.window
    }

    public preloadWindow(): void {
        if (!this.window || this.window.isDestroyed()) {
            this.createWindow(-10000, -10000, false);
        }
    }

    public showWindow(x: number, y: number, options: WindowActivationOptions = {}): void {
        if (!this.window || this.window.isDestroyed()) {
            this.createWindow(x, y)
            return
        }

        const activate = options.activate ?? true;

        // Set parent and align window settings
        const mainWin = this.windowHelper?.getMainWindow();
        const isOverlay = mainWin === this.windowHelper?.getOverlayWindow();

        if (mainWin && !mainWin.isDestroyed()) {
            this.window.setParentWindow(mainWin);
        }

        // Keep preloaded or already-open selector windows in sync with the UI width.
        // Without this, an old 140px window clips the widened React dropdown.
        this.window.setSize(MODEL_SELECTOR_WIDTH, MODEL_SELECTOR_HEIGHT);

        if (process.platform === "darwin") {
            // Align with parent window behavior
            this.window.setVisibleOnAllWorkspaces(isOverlay, { visibleOnFullScreen: isOverlay });
            // Only set alwaysOnTop if the value is actually changing — calling it unnecessarily
            // triggers NSApp activation on macOS, stealing focus from other apps.
            const currentAlwaysOnTop = this.window.isAlwaysOnTop();
            if (currentAlwaysOnTop !== isOverlay) {
                this.window.setAlwaysOnTop(isOverlay, "floating");
            }
            // Always hide from MC as it's a dropdown
            this.window.setHiddenInMissionControl(true);
        }

        // Standard dropdown positioning
        this.window.setPosition(Math.round(x), Math.round(y))
        this.ensureVisibleOnScreen();

        if (process.platform === 'win32' && this.contentProtection) {
            this.window.setOpacity(0);
            if (activate) this.window.show(); else this.window.showInactive();
            this.window.setContentProtection(true);

            if (this.opacityTimeout) clearTimeout(this.opacityTimeout);
            this.opacityTimeout = setTimeout(() => {
                if (this.window && !this.window.isDestroyed()) {
                    this.window.setOpacity(1);
                    if (activate) this.window.focus();
                }
            }, 60);
        } else {
            this.window.setContentProtection(this.contentProtection);
            if (activate) this.window.show(); else this.window.showInactive();
            if (activate) this.window.focus();
        }
    }

    public hideWindow(): void {
        if (this.window && !this.window.isDestroyed()) {
            this.window.setParentWindow(null);
            this.window.hide();
            // Do NOT call mainWin.focus() here — the model selector is a floating dropdown.
            // Explicitly focusing the main window steals OS focus from whatever the user
            // had active (Zoom, browser, etc.) before opening the selector.
        }
    }

    public toggleWindow(x: number, y: number): void {
        if (this.window && !this.window.isDestroyed()) {
            // Fix: If window was just closed by blur (e.g. clicking the toggle button), don't re-open immediately
            if (!this.window.isVisible() && (Date.now() - this.lastBlurTime < 250)) {
                return;
            }

            if (this.window.isVisible()) {
                this.hideWindow()
            } else {
                this.showWindow(x, y)
            }
        } else {
            this.createWindow(x, y)
        }
    }

    public closeWindow(): void {
        this.hideWindow();
    }

    private createWindow(x?: number, y?: number, showWhenReady: boolean = true): void {
        const windowSettings: Electron.BrowserWindowConstructorOptions = {
            width: MODEL_SELECTOR_WIDTH,
            height: MODEL_SELECTOR_HEIGHT,
            frame: false,
            transparent: true,
            resizable: false,
            fullscreenable: false,
            hasShadow: false,
            alwaysOnTop: true,
            backgroundColor: "#00000000",
            show: false,
            skipTaskbar: true,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, "preload.js"),
                backgroundThrottling: false
            }
        }

        if (x !== undefined && y !== undefined) {
            windowSettings.x = Math.round(x)
            windowSettings.y = Math.round(y)
        }

        this.window = new BrowserWindow(windowSettings)

        if (process.platform === "darwin") {
            // Initial defaults - will be updated in showWindow
            this.window.setHiddenInMissionControl(true)
        }

        // Apply content protection for Undetectable Mode
        console.log(`[ModelSelectorWindowHelper] Creating window with Content Protection: ${this.contentProtection}`);
        this.window.setContentProtection(this.contentProtection)

        // Load with query param for routing
        const cacheBust = Date.now();
        const url = isDev
            ? `${startUrl}?window=model-selector&v=${cacheBust}`
            : `${startUrl}?window=model-selector&v=${cacheBust}`

        this.window.loadURL(url).catch(async (e) => {
            console.error('[ModelSelectorWindowHelper] Failed to load URL:', e);
            if (isDev && this.window && !this.window.isDestroyed()) {
                try {
                    await this.window.loadURL(`${fallbackFileUrl}?window=model-selector&v=${cacheBust}`);
                    console.log('[ModelSelectorWindowHelper] Fallback to file URL succeeded');
                } catch (fallbackError) {
                    console.error('[ModelSelectorWindowHelper] Fallback to file URL failed:', fallbackError);
                }
            }
        });
        this.window.webContents.on('render-process-gone', (_event, details) => {
            console.error(`[ModelSelectorWindowHelper] Selector renderer gone: reason=${details.reason} exitCode=${details.exitCode}`);
        });
        this.window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
            if (level >= 2) {
                console.error(`[Renderer/model-selector] ${sourceId}:${line} ${message}`);
            }
        });

        this.window.once('ready-to-show', () => {
            if (showWhenReady) {
                this.showWindow(this.window?.getBounds().x || 0, this.window?.getBounds().y || 0)
            }
        })

        // Close on blur (click outside)
        this.window.on('blur', () => {
            if (this.ignoreBlur) return;
            this.lastBlurTime = Date.now();
            this.hideWindow();
        })
    }

    private ensureVisibleOnScreen() {
        if (!this.window) return;
        const { x, y, width, height } = this.window.getBounds();
        const display = screen.getDisplayNearestPoint({ x, y });
        const bounds = display.workArea;

        let newX = x;
        let newY = y;

        // Keep within horizontal bounds
        if (x + width > bounds.x + bounds.width) {
            newX = bounds.x + bounds.width - width;
        }
        if (x < bounds.x) {
            newX = bounds.x;
        }

        // Keep within vertical bounds
        if (y + height > bounds.y + bounds.height) {
            newY = bounds.y + bounds.height - height;
        }
        if (y < bounds.y) {
            newY = bounds.y;
        }

        this.window.setPosition(newX, newY);
    }

    public setContentProtection(enable: boolean): void {
        console.log(`[ModelSelectorWindowHelper] Setting content protection to: ${enable}`);
        this.contentProtection = enable;
        if (this.window && !this.window.isDestroyed()) {
            this.window.setContentProtection(enable);
        }
    }
}
