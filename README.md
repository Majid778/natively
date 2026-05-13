<div align="center">
  <img src="assets/icon.png" width="120" alt="Natively OSS logo">

# Natively OSS

A local-first AI meeting copilot for private use with friends, study groups, and small teams.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![Windows](https://img.shields.io/badge/Windows-10%2F11-0078D4.svg)](#install-on-windows)
[![BYOK](https://img.shields.io/badge/AI-Bring%20Your%20Own%20Key-22c55e.svg)](#openrouter-setup)

</div>

## What It Does

Natively OSS gives you a small desktop AI panel that can listen to a meeting, keep rolling context, and answer quick prompts using your own OpenRouter API key. It is designed as a personal/local-first fork without a hosted paid backend, subscriptions, quotas, or donation prompts.

Current default stack:

- AI model routing: OpenRouter, defaulting to Google Gemini 2.5 Flash.
- Cloud transcription: Deepgram Flux.
- Audio capture: native Windows audio module built from Rust.
- Data storage: local SQLite database on your machine.
- Modes: reusable prompt presets for different contexts.

## Install On Windows

The easiest path is to download the portable `.exe` from GitHub Releases.

1. Open the latest release on this repository.
2. Download `Natively OSS-<version>-portable.exe`.
3. Run the file.
4. If Windows SmartScreen appears, click `More info`, then `Run anyway`.
5. Open Settings, add your OpenRouter and Deepgram API keys, then test both cards.

This build is unsigned, so SmartScreen warnings are expected for now.

## Ask Claude To Install It

If you are sharing this with a friend, you can tell them to paste this into Claude:

```text
Install Natively OSS from this GitHub repository on my Windows computer. Use the latest GitHub Release if one exists. Download the Windows build, run it, then help me add my OpenRouter and Deepgram API keys in Settings > AI Providers. If there is no release artifact, clone the repo and follow the developer setup instructions in README.md.
```

## OpenRouter Setup

1. Create an OpenRouter key at https://openrouter.ai/keys.
2. Open `Settings > AI Providers` in Natively OSS.
3. Paste the key, click `Save`, then `Test`.
4. The app automatically uses Gemini 2.5 Flash.

Your key is stored locally through the app credential manager. Do not commit API keys to GitHub.

## Deepgram Setup

Natively OSS uses Deepgram Flux for the friend-ready transcription path.

1. Create a Deepgram key at https://console.deepgram.com/project/keys.
2. Open `Settings > AI Providers`.
3. Paste the key, click `Save`, then `Test`.
4. Speak during the 3-second mic test and confirm a transcript appears.

If transcription fails, check:

- The Deepgram key has access to Flux.
- Windows microphone/system audio permissions are enabled.

## Developer Setup

Requirements:

- Windows 10/11
- Node.js 22
- Rust toolchain
- Visual Studio C++ Build Tools

Install and run in development:

```powershell
npm ci
npm run build:native
npm run app:dev
```

Build a portable Windows EXE:

```powershell
npm run dist:win
```

The artifact is written to `release/`.

If native build fails because the app is open, close all running Natively/Electron windows and run `npm run build:native` again.

## Release Checklist

Before sharing a release with friends:

1. Run `npm run build`.
2. Run `npm run build:electron`.
3. Run `npm run build:native`.
4. Run `npm run dist:win`.
5. Test the generated portable EXE from `release/` outside the repo.
6. Verify OpenRouter key save/verify works.
7. Start a meeting and confirm Deepgram transcription works with YouTube/system audio.
8. Press an AI panel action and confirm it uses the selected OpenRouter model.
9. Stop the meeting and confirm the launcher returns and a summary is generated.

## Privacy

Natively OSS stores transcripts, summaries, settings, and modes locally. It does not include the hosted paid backend or a hosted backend. AI prompts are sent to OpenRouter, and meeting audio/transcription is sent to Deepgram when you use the default cloud transcription path.

This fork should not include analytics or tracking. If you find any telemetry code, treat it as a bug and remove it before release.

## Known Limitations

- Windows builds are unsigned, so SmartScreen warnings are expected.
- Friends need their own OpenRouter and Deepgram API keys.
- The portable EXE is the recommended distribution path for now; a signed installer can come later.
- Some older source files may still mention calendar or stealth features internally, but they are not part of the simplified public setup path.

## License

AGPL-3.0. See [LICENSE](LICENSE).
