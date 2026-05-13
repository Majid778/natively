# Product Readiness

## Current Status

Natively OSS is ready for local development and close-friends beta testing. It is not yet a polished public release until a clean packaged build passes the QA checklist.

Working pieces:

- OpenRouter model routing with Gemini 2.5 Flash as the fixed default.
- Deepgram Flux cloud transcription as the friend-ready default.
- AI Providers setup for exactly two required keys: OpenRouter and Deepgram.
- Manage Modes for reusable prompts.
- Native Windows audio capture module.
- Movable AI panel with opacity settings.
- Stop flow returns to launcher and generates a summary.
- Windows installer and portable build path via `npm run dist:win`.

## Remaining Release Risks

1. Windows builds are unsigned and will trigger SmartScreen.
2. Full clean-machine QA still needs to be repeated from the packaged EXE.
3. Friends must bring their own OpenRouter and Deepgram keys.
4. Some deeper legacy provider hooks remain in source for compatibility, but they are not shown in the simplified setup path.

## Beta Definition Of Done

- Windows installer and portable EXE build locally and in GitHub Actions.
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
