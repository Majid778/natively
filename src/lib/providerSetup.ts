// Shared client-side helpers to connect the two API providers Natively needs.
// Used by the onboarding wizard (and safe to reuse elsewhere) so the save
// sequence lives in one place. Mirrors the flow in AIProvidersSettings.

const OPENROUTER_MODEL_ID = 'google/gemini-2.5-flash';
const OPENROUTER_PROVIDER_ID = 'openrouter-google-gemini-2-5-flash';
const OPENROUTER_MODEL_LABEL = 'Google Gemini 2.5 Flash';

const buildOpenRouterCurl = (apiKey: string): string =>
  `curl https://openrouter.ai/api/v1/chat/completions -H "Authorization: Bearer ${apiKey}" -H "Content-Type: application/json" -H "X-Title: Natively" -d '{"model":"${OPENROUTER_MODEL_ID}","messages":[{"role":"user","content":"{{TEXT}}"}],"temperature":0.2}'`;

export async function saveOpenRouterKey(rawKey: string): Promise<{ success: boolean; error?: string }> {
  const key = rawKey.trim();
  if (!key) return { success: false, error: 'Paste your OpenRouter key first.' };
  if (!key.startsWith('sk-or-v1-')) return { success: false, error: 'OpenRouter keys start with sk-or-v1-.' };
  try {
    const validation = await window.electronAPI?.validateOpenRouterKey?.(key);
    if (!validation?.success) return { success: false, error: validation?.error || 'That key did not validate.' };
    if (validation.hasCredits === false) return { success: false, error: 'The key is valid but has no remaining credits.' };

    await window.electronAPI?.setOpenRouterApiKey?.(key);
    const saved = await window.electronAPI?.saveCustomProvider?.({
      id: OPENROUTER_PROVIDER_ID,
      name: `OpenRouter (${OPENROUTER_MODEL_LABEL})`,
      curlCommand: buildOpenRouterCurl(key),
      responsePath: 'choices[0].message.content',
    });
    if (saved && saved.success === false) return { success: false, error: saved.error || "Couldn't save the key." };
    await window.electronAPI?.setDefaultModel?.(OPENROUTER_PROVIDER_ID);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error?.message || "Couldn't save the key." };
  }
}

export async function saveDeepgramKey(rawKey: string): Promise<{ success: boolean; error?: string }> {
  const key = rawKey.trim();
  if (!key) return { success: false, error: 'Paste your Deepgram key first.' };
  try {
    const saved = await window.electronAPI?.setDeepgramApiKey?.(key);
    if (saved && saved.success === false) return { success: false, error: saved.error || "Couldn't save the key." };
    const providerSet = await window.electronAPI?.setSttProvider?.('deepgram');
    if (providerSet && providerSet.success === false) return { success: false, error: providerSet.error || "Couldn't set transcription." };
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error?.message || "Couldn't save the key." };
  }
}
