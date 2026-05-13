# Friend Install Guide

This is the short version to send to a friend.

## Install

1. Open the latest GitHub Release.
2. Download `Natively OSS-<version>-portable.exe` or the setup installer.
3. Run it.
4. If Windows SmartScreen appears, choose `More info` then `Run anyway`.

## First Setup

1. Open Settings.
2. Go to `AI Providers`.
3. Paste an OpenRouter API key and click `Save`, then `Test`.
4. Paste a Deepgram API key and click `Save`, then `Test`.
5. Keep Gemini 2.5 Flash and Deepgram Flux as the defaults.

## Required Keys

- OpenRouter powers the AI responses with `google/gemini-2.5-flash`.
- Deepgram powers meeting transcription with Flux.
- No API keys are bundled with the app. Each friend uses their own keys.

## Claude Prompt

```text
Install Natively OSS from this GitHub repository. Download the latest Windows build from Releases, run it, and help me add my OpenRouter and Deepgram API keys in Settings > AI Providers. Test both providers before starting a meeting.
```

## Common Fixes

- If AI responses fail, re-test the OpenRouter card and check credits.
- If transcription fails, re-test the Deepgram card and make sure microphone permission is enabled.
- If meeting audio fails in development, run `npm run build:native`, then relaunch.
