# Privacy Policy

## Overview

Natively OSS is a local-first desktop app. It does not include the hosted paid backend, a hosted subscription backend, quota tracking, or analytics.

## What Stays Local

- App settings
- Mode presets
- Uploaded reference files
- Meeting transcripts
- Generated summaries
- Local search/index data
- API keys stored by the local credential manager

## What Can Leave Your Machine

Only data required for features you explicitly configure or start can leave your machine:

- AI prompts and relevant context are sent to your selected AI provider, such as OpenRouter.
- Software update checks may contact GitHub if updater code is enabled for a release build.
- Local `whisper.cpp` transcription runs on `127.0.0.1` and is intended to stay on your machine.

## Analytics

This fork should not send Google Analytics, marketing telemetry, or product analytics. If telemetry is found in a future change, treat it as a bug and remove it before release.

## API Keys

API keys are stored locally. Do not commit keys to GitHub, paste them into issues, or include them in screenshots.

## Local Transcription

The managed `whisper.cpp` server listens locally. On first use, the app may download the Windows `whisper.cpp` binary and the selected GGML model file into the app data folder.

## Contact

For a friends/private fork, report issues directly to the repo owner or through GitHub issues if the repository is shared.
