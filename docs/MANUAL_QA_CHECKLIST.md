# Manual QA Checklist

Run this before sharing Windows or macOS builds with friends.

## Windows Build

- [ ] Close any running Natively/Electron instances.
- [ ] Run `npm run build`.
- [ ] Run `npm run build:electron`.
- [ ] Run `npm run build:native`.
- [ ] Run `npm run dist:win`.
- [ ] Confirm installer and portable `.exe` artifacts exist in `release/`.

## macOS Build And Smoke

- [ ] Close any running Natively/Electron instances.
- [ ] Run `npm run dist:mac`.
- [ ] Confirm `.dmg` artifacts exist in `release/`.
- [ ] Open the DMG and drag `Natively OSS.app` to Applications.
- [ ] Confirm Gatekeeper first-launch warning appears for the unsigned/ad-hoc app.
- [ ] Right-click `Natively OSS.app`, choose `Open`, and confirm the app launches.
- [ ] If quarantine blocks launch, run `xattr -dr com.apple.quarantine "/Applications/Natively OSS.app"` and launch again.
- [ ] Confirm Screen Recording permission prompt appears when system audio capture starts.
- [ ] Confirm Microphone permission prompt appears when microphone capture starts.
- [ ] Play a YouTube video and confirm system audio transcription appears.
- [ ] Speak into the microphone and confirm user transcription appears.

## First Launch

- [ ] Launch the packaged app outside the repo folder.
- [ ] App opens to the launcher, not the AI meeting panel.
- [ ] Settings opens and closes cleanly.
- [ ] Clicking outside the settings frame closes settings.

## AI Providers

- [ ] Open `Settings > AI Providers`.
- [ ] Paste an OpenRouter key, save it, and test it.
- [ ] Confirm Gemini 2.5 Flash is the text model.
- [ ] Paste a Deepgram key, save it, and test it with a 3-second mic sample.
- [ ] Restart the app and confirm both provider cards still show saved.

## Manage Modes

- [ ] Open `Settings > Manage Modes`.
- [ ] Create a new mode.
- [ ] Rename it from the triple-dot menu.
- [ ] Delete it and confirm the confirmation dialog appears.
- [ ] Upload a reference file and confirm it appears in the list.

## Meeting Flow

- [ ] Start Natively from the launcher.
- [ ] AI panel appears only after start.
- [ ] Play a YouTube video and confirm system audio transcription appears.
- [ ] Speak into the microphone and confirm user transcription appears.
- [ ] Press an AI panel action and confirm a response appears.
- [ ] Press Stop and confirm the AI panel closes and launcher returns.
- [ ] Confirm the meeting summary is generated after stop.

## Failure Modes

- [ ] Missing OpenRouter key shows a clear Settings action.
- [ ] Missing Deepgram key shows a clear Settings action.
- [ ] Bad OpenRouter key shows a readable error.
- [ ] Bad Deepgram key shows a readable error.
- [ ] Missing native audio module shows a readable developer fix.

## Packaging Sanity

- [ ] Test on clean Windows and macOS machines if possible.
- [ ] Confirm SmartScreen and Gatekeeper warnings are documented.
- [ ] Confirm no API keys are committed.
