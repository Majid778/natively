## Summary

Short description of this release.

## Download

- Windows: download the portable `.exe` attached to this release.

## Install Notes

Windows builds are currently unsigned. If SmartScreen appears, choose `More info` then `Run anyway`.

## First Setup

1. Add an OpenRouter API key in `Settings > AI Providers`.
2. Verify the key.
3. Keep Gemini 2.5 Flash selected unless you want to use another preset.

## Local Transcription

If transcription fails on a clean machine, install Python dependencies:

```powershell
python -m pip install --user flask faster-whisper
```

## Verification

- [ ] App opens to launcher.
- [ ] OpenRouter verify works.
- [ ] Meeting starts and transcribes system audio.
- [ ] AI panel actions return responses.
- [ ] Stop returns to launcher and summary is generated.
