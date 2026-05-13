# Natively OSS Friend Setup

This is the guide to send to someone who just wants to install and run the app.

## What You Need

- Windows 10 or 11.
- An OpenRouter API key for AI responses.
- A Deepgram API key for live transcription.

## Install

1. Open the latest GitHub Release for this repo.
2. Download either the setup installer or `Natively OSS-<version>-portable.exe`.
3. Run the app.
4. If Windows SmartScreen appears, click `More info`, then `Run anyway`.

## Setup In The App

1. Open Settings.
2. Go to `AI Providers`.
3. In `Text AI`, open the OpenRouter key page, create a key, paste it, click `Save`, then `Test`.
4. In `Transcription`, open the Deepgram key page, create a key, paste it, click `Save`, then `Test`.
5. Start Natively from the launcher.

## Expected Behavior

- The app opens to the launcher first.
- The AI panel only appears after pressing Start.
- The Stop button closes the AI panel and brings the launcher back.
- Meeting summaries are generated after stopping.

## Privacy

The app stores settings, modes, transcripts, and summaries locally. OpenRouter receives the AI prompt context. Deepgram receives meeting audio for transcription. No OpenRouter or Deepgram keys are included in the repo or release.

## Troubleshooting

- AI test fails: check your OpenRouter key and credits.
- Transcription test fails: check your Deepgram key, microphone permission, and internet connection.
- Meeting audio fails in a dev clone: run `npm run build:native`, then relaunch.
