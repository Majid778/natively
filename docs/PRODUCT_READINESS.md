# Product Readiness

## Current Status

Natively OSS is ready for local development and close-friends beta testing on Windows and macOS. It is not yet a polished public release until clean packaged builds pass the QA checklist on both platforms.

Working pieces:

- OpenRouter model routing with Gemini 2.5 Flash as the fixed default.
- Deepgram Flux cloud transcription as the friend-ready default.
- AI Providers setup for exactly two required keys: OpenRouter and Deepgram.
- Manage Modes for reusable prompts.
- Native desktop audio capture module.
- Movable AI panel with opacity settings.
- Stop flow returns to launcher and generates a summary.
- Windows installer and portable build path via `npm run dist:win`.
- macOS DMG and ZIP build path via `npm run dist:mac`.

## Remaining Release Risks

1. Windows builds are unsigned and will trigger SmartScreen.
2. macOS builds are unsigned/ad-hoc signed and will trigger Gatekeeper on first launch.
3. macOS auto-update is semi-automatic while unsigned; users may need to approve the updated app through Gatekeeper.
4. Full clean-machine QA still needs to be repeated from packaged Windows and macOS artifacts.
5. Friends must bring their own OpenRouter and Deepgram keys.
6. Some deeper legacy provider hooks remain in source for compatibility, but they are not shown in the simplified setup path.

## Beta Definition Of Done

- Windows installer and portable EXE build locally and in GitHub Actions.
- macOS DMG and ZIP artifacts build locally and in GitHub Actions.
- GitHub Releases include Windows and macOS electron-updater manifests.
- README install path works when followed by a non-developer.
- OpenRouter key save/test survives restart.
- Deepgram key save/test records a 3-second mic sample and returns text.
- Start opens the AI panel only after setup is complete.
- AI panel actions use OpenRouter Gemini 2.5 Flash.
- Stop closes the AI panel, returns the launcher, and generates a summary.
- No analytics, hosted paid backend, donation prompts, quota UI, or subscription copy is visible.

## Later Improvements

- Add optional signed installer.
- Add automated smoke tests for first launch and meeting lifecycle.
- Reduce app size by trimming unused legacy provider dependencies.
- Add a small first-run setup wizard if friends still miss the Settings flow.
