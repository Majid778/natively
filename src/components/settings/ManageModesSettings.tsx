import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Edit2, FileText, MoreHorizontal, Plus, Save, Sparkles, Trash2, Upload, X } from 'lucide-react';

type ModeReferenceFile = {
  id: string;
  name: string;
  size: number;
  storedPath?: string;
  text?: string;
  uploadedAt: string;
};

type RealtimeMode = {
  id: string;
  name: string;
  prompt: string;
  referenceFiles?: ModeReferenceFile[];
  createdAt: string;
  updatedAt: string;
};

type ModesConfig = {
  modes: RealtimeMode[];
  activeModeId: string | null;
};

const buildPromptMap = (modes: RealtimeMode[]): Record<string, string> =>
  modes.reduce((acc, mode) => {
    acc[mode.id] = mode.prompt;
    return acc;
  }, {} as Record<string, string>);

const DEFAULT_MODE_PROMPT = `You are my real-time interview copilot. Give concise, natural first-person responses that sound like a real person speaking live. Keep answers confident, specific, and practical.`;

const makeModeId = () => `mode-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createMode = (name = 'New Mode'): RealtimeMode => {
  const now = new Date().toISOString();
  return {
    id: makeModeId(),
    name,
    prompt: DEFAULT_MODE_PROMPT,
    createdAt: now,
    updatedAt: now,
  };
};

const normalizeConfig = (raw: any): ModesConfig => {
  const fallbackMode = createMode('General');
  fallbackMode.id = 'general';

  const source = Array.isArray(raw?.modes) ? raw.modes : [fallbackMode];
  const modes = source
    .map((mode: any, index: number) => {
      const prompt = String(mode?.prompt || '').trim();
      if (!prompt) return null;
      return {
        id: String(mode?.id || '').trim() || `mode-${index + 1}`,
        name: String(mode?.name || '').trim() || `Mode ${index + 1}`,
        prompt,
        referenceFiles: Array.isArray(mode?.referenceFiles)
          ? mode.referenceFiles
              .map((file: any) => ({
                id: String(file?.id || '').trim() || `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                name: String(file?.name || '').trim() || 'Reference file',
                size: Number.isFinite(Number(file?.size)) ? Number(file.size) : 0,
                storedPath: typeof file?.storedPath === 'string' ? file.storedPath : undefined,
                text: typeof file?.text === 'string' ? file.text : '',
                uploadedAt: String(file?.uploadedAt || '').trim() || new Date().toISOString(),
              }))
              .filter((file: ModeReferenceFile) => file.name)
          : [],
        createdAt: String(mode?.createdAt || '').trim() || new Date().toISOString(),
        updatedAt: String(mode?.updatedAt || '').trim() || new Date().toISOString(),
      };
    })
    .filter(Boolean) as RealtimeMode[];

  const finalModes = modes.length > 0 ? modes : [fallbackMode];
  const activeModeId =
    raw?.activeModeId && finalModes.some((mode) => mode.id === raw.activeModeId)
      ? raw.activeModeId
      : finalModes[0].id;

  return { modes: finalModes, activeModeId };
};

export const ManageModesSettings: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modes, setModes] = useState<RealtimeMode[]>([]);
  const [savedPrompts, setSavedPrompts] = useState<Record<string, string>>({});
  const [activeModeId, setActiveModeId] = useState<string | null>(null);
  const [selectedModeId, setSelectedModeId] = useState<string | null>(null);
  const [isModeMenuOpen, setIsModeMenuOpen] = useState(false);
  const [isActionsMenuOpen, setIsActionsMenuOpen] = useState(false);
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const modeMenuRef = useRef<HTMLDivElement | null>(null);
  const actionsMenuRef = useRef<HTMLDivElement | null>(null);

  // AI mode-prompt generator (freeform description → fills the prompt box)
  const [isGenOpen, setIsGenOpen] = useState(false);
  const [genDesc, setGenDesc] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState('');

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const api = window.electronAPI?.modesGetConfig;
        const incoming = api ? await api() : null;
        const normalized = normalizeConfig(incoming);
        if (cancelled) return;

        setModes(normalized.modes);
        setSavedPrompts(buildPromptMap(normalized.modes));
        setActiveModeId(normalized.activeModeId);
        setSelectedModeId(normalized.activeModeId || normalized.modes[0]?.id || null);
      } catch (error: any) {
        if (cancelled) return;
        const fallback = normalizeConfig(null);
        setModes(fallback.modes);
        setSavedPrompts(buildPromptMap(fallback.modes));
        setActiveModeId(fallback.activeModeId);
        setSelectedModeId(fallback.activeModeId);
        setErrorMessage(error?.message || 'Failed to load modes.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedMode = useMemo(
    () => modes.find((mode) => mode.id === selectedModeId) || null,
    [modes, selectedModeId]
  );

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;

      if (modeMenuRef.current && !modeMenuRef.current.contains(target)) {
        setIsModeMenuOpen(false);
      }
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(target)) {
        setIsActionsMenuOpen(false);
      }
    };

    if (isModeMenuOpen || isActionsMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isModeMenuOpen, isActionsMenuOpen]);

  const persistConfig = async (nextModes: RealtimeMode[], nextActiveModeId: string | null, nextSelectedModeId?: string | null) => {
    setSaving(true);
    setErrorMessage('');
    setStatusMessage('');

    const payload = {
      modes: nextModes.map((mode) => ({ ...mode, updatedAt: new Date().toISOString() })),
      activeModeId: nextActiveModeId,
    };

    try {
      const response = await window.electronAPI?.modesSaveConfig?.(payload);
      if (response && response.success === false) {
        throw new Error(response.error || 'Failed to save modes.');
      }

      const normalized = normalizeConfig(response?.config || payload);
      setModes(normalized.modes);
      setSavedPrompts(buildPromptMap(normalized.modes));
      setActiveModeId(normalized.activeModeId);
      setSelectedModeId(nextSelectedModeId ?? selectedModeId ?? normalized.activeModeId);
      setStatusMessage('Saved.');
    } catch (error: any) {
      setErrorMessage(error?.message || 'Failed to save modes.');
    } finally {
      setSaving(false);
    }
  };

  const updateSelectedMode = (patch: Partial<RealtimeMode>) => {
    if (!selectedModeId) return;
    setModes((current) =>
      current.map((mode) => (mode.id === selectedModeId ? { ...mode, ...patch } : mode))
    );
  };

  const isPromptDirty = useMemo(() => {
    if (!selectedMode) return false;
    const savedPrompt = savedPrompts[selectedMode.id];
    if (typeof savedPrompt !== 'string') return selectedMode.prompt.trim().length > 0;
    return selectedMode.prompt !== savedPrompt;
  }, [selectedMode, savedPrompts]);

  const handleCreateMode = async () => {
    const existingNames = new Set(modes.map((mode) => mode.name.toLowerCase()));
    let name = 'New Mode';
    let suffix = 2;
    while (existingNames.has(name.toLowerCase())) {
      name = `New Mode ${suffix}`;
      suffix += 1;
    }

    const newMode = createMode(name);
    const nextModes = [newMode, ...modes];
    setModes(nextModes);
    setSelectedModeId(newMode.id);
    setActiveModeId(newMode.id);
    setIsModeMenuOpen(false);
    setStatusMessage('');
    setErrorMessage('');
    await persistConfig(nextModes, newMode.id, newMode.id);
  };

  const handleGenerate = async () => {
    if (!selectedModeId) return;
    if (!window.electronAPI?.generateModePrompt) {
      setGenError('Prompt generation is unavailable in this build.');
      return;
    }
    if (!genDesc.trim()) {
      setGenError('Describe what you want this mode to do first.');
      return;
    }
    setGenerating(true);
    setGenError('');
    try {
      const res = await window.electronAPI.generateModePrompt({ description: genDesc.trim() });
      if (!res?.success || !res.prompt) {
        throw new Error(res?.error || 'No prompt was generated.');
      }
      updateSelectedMode({ prompt: res.prompt });
      setIsGenOpen(false);
    } catch (error: any) {
      setGenError(error?.message || 'Failed to generate prompt.');
    } finally {
      setGenerating(false);
    }
  };

  const handleDeleteSelected = async () => {
    if (!selectedMode) return;
    if (modes.length <= 1) {
      setErrorMessage('At least one mode is required.');
      return;
    }

    const nextModes = modes.filter((mode) => mode.id !== selectedMode.id);
    const nextActive = activeModeId === selectedMode.id ? nextModes[0]?.id || null : activeModeId;
    const nextSelected = nextModes[0]?.id || null;

    setModes(nextModes);
    setActiveModeId(nextActive);
    setSelectedModeId(nextSelected);
    await persistConfig(nextModes, nextActive, nextSelected);
  };

  const handleSelectMode = (modeId: string) => {
    setSelectedModeId(modeId);
    setIsModeMenuOpen(false);
    setIsActionsMenuOpen(false);
    setIsRenameDialogOpen(false);
    setIsDeleteDialogOpen(false);
  };

  const handleToggleActive = async () => {
    if (!selectedMode) return;
    const nextActive = activeModeId === selectedMode.id ? null : selectedMode.id;
    setActiveModeId(nextActive);
    await persistConfig(modes, nextActive, selectedMode.id);
  };

  const openRenameDialog = () => {
    if (!selectedMode) return;
    setRenameDraft(selectedMode.name);
    setIsRenameDialogOpen(true);
    setIsActionsMenuOpen(false);
  };

  const confirmRenameMode = async () => {
    if (!selectedMode) return;
    const nextName = renameDraft.trim();
    if (!nextName) {
      setErrorMessage('Mode name cannot be empty.');
      return;
    }
    if (nextName === selectedMode.name) {
      setIsRenameDialogOpen(false);
      return;
    }

    const nextModes = modes.map((mode) =>
      mode.id === selectedMode.id ? { ...mode, name: nextName } : mode
    );
    setModes(nextModes);
    setIsRenameDialogOpen(false);
    await persistConfig(nextModes, activeModeId, selectedMode.id);
  };

  const openDeleteDialog = () => {
    setIsDeleteDialogOpen(true);
    setIsActionsMenuOpen(false);
  };

  const confirmDeleteMode = async () => {
    setIsDeleteDialogOpen(false);
    await handleDeleteSelected();
  };

  const handleUploadReferenceFiles = async () => {
    if (!selectedMode) return;
    setUploadingFiles(true);
    setStatusMessage('');
    setErrorMessage('');

    try {
      const response = await window.electronAPI?.modesUploadReferenceFiles?.();
      if (!response || response.cancelled) return;
      if (response.success === false) {
        throw new Error(response.error || 'Failed to upload reference files.');
      }

      const uploadedFiles = response.files || [];
      if (uploadedFiles.length === 0) return;

      const existingFiles = selectedMode.referenceFiles || [];
      const nextModes = modes.map((mode) =>
        mode.id === selectedMode.id
          ? {
              ...mode,
              referenceFiles: [...existingFiles, ...uploadedFiles],
            }
          : mode
      );

      setModes(nextModes);
      await persistConfig(nextModes, activeModeId, selectedMode.id);
      setStatusMessage(`Uploaded ${uploadedFiles.length} reference file${uploadedFiles.length === 1 ? '' : 's'}.`);
    } catch (error: any) {
      setErrorMessage(error?.message || 'Failed to upload reference files.');
    } finally {
      setUploadingFiles(false);
    }
  };

  const handleRemoveReferenceFile = async (fileId: string) => {
    if (!selectedMode) return;
    const nextModes = modes.map((mode) =>
      mode.id === selectedMode.id
        ? {
            ...mode,
            referenceFiles: (mode.referenceFiles || []).filter((file) => file.id !== fileId),
          }
        : mode
    );

    setModes(nextModes);
    await persistConfig(nextModes, activeModeId, selectedMode.id);
  };

  const formatFileSize = (bytes: number) => {
    if (!Number.isFinite(bytes) || bytes <= 0) return 'Unknown size';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (loading) {
    return (
      <div className="space-y-3 animated fadeIn">
        <div className="h-10 rounded-xl bg-bg-item-surface border border-border-subtle animate-pulse" />
        <div className="h-64 rounded-xl bg-bg-item-surface border border-border-subtle animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-4 animated fadeIn">
      <div>
        <h3 className="text-lg font-bold text-text-primary">Manage Modes</h3>
        <p className="text-xs text-text-secondary mt-1">
          Create reusable real-time prompts and switch your active mode instantly.
        </p>
      </div>

      {selectedMode ? (
        <div className="space-y-3">
          <div className="bg-bg-item-surface rounded-xl border border-border-subtle p-3 flex items-center justify-between gap-3">
            <div className="relative w-full max-w-[560px]" ref={modeMenuRef}>
              <button
                onClick={() => setIsModeMenuOpen((open) => !open)}
                className="w-full h-12 rounded-xl border border-border-subtle bg-bg-input hover:bg-bg-elevated px-4 text-base text-text-primary flex items-center justify-between transition-colors"
              >
                <span className="truncate">{selectedMode.name}</span>
                <ChevronDown size={16} className={`text-text-secondary transition-transform ${isModeMenuOpen ? 'rotate-180' : ''}`} />
              </button>

              {isModeMenuOpen && (
                <div className="absolute z-30 mt-1.5 w-full rounded-lg border border-border-subtle bg-bg-elevated shadow-xl overflow-hidden animated fadeIn">
                  <div className="max-h-64 overflow-y-auto custom-scrollbar p-1 space-y-0.5">
                    {modes.map((mode) => {
                      const isSelected = selectedModeId === mode.id;
                      const isActive = activeModeId === mode.id;
                      return (
                        <button
                          key={mode.id}
                          onClick={() => handleSelectMode(mode.id)}
                          className={`w-full text-left px-3 py-2.5 text-base rounded-md transition-colors flex items-center justify-between gap-2 ${
                            isSelected ? 'bg-bg-input text-text-primary' : 'text-text-secondary hover:bg-bg-input hover:text-text-primary'
                          }`}
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <FileText size={14} className="shrink-0 opacity-80" />
                            <span className="truncate">{mode.name}</span>
                          </span>
                          {isActive && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-accent-primary px-1.5 py-0.5 text-[10px] font-medium text-white shrink-0">
                              <Check size={11} />
                              <span>Active</span>
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <div className="border-t border-border-subtle p-1">
                    <button
                      onClick={handleCreateMode}
                      className="w-full text-left px-3 py-2.5 rounded-md text-base text-text-primary bg-bg-input hover:bg-bg-elevated transition-colors flex items-center gap-2"
                    >
                      <Plus size={14} />
                      New Mode
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleToggleActive}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors inline-flex items-center gap-1.5 ${
                  activeModeId === selectedMode.id
                    ? 'border-accent-primary bg-accent-primary text-white'
                    : 'border-border-subtle bg-bg-input text-text-secondary hover:text-text-primary'
                }`}
                title={activeModeId === selectedMode.id ? 'Unset active mode' : 'Set as active mode'}
              >
                {activeModeId === selectedMode.id ? (
                  <>
                    <Check size={12} />
                    Active
                  </>
                ) : (
                  'Set Active'
                )}
              </button>

              <div className="relative" ref={actionsMenuRef}>
                <button
                  onClick={() => setIsActionsMenuOpen((open) => !open)}
                  className="w-8 h-8 rounded-full border border-border-subtle text-text-secondary hover:text-text-primary hover:bg-bg-input flex items-center justify-center transition-colors"
                  title="More actions"
                >
                  <MoreHorizontal size={14} />
                </button>

                {isActionsMenuOpen && (
                  <div className="absolute right-0 top-full mt-1 w-44 rounded-lg border border-border-subtle bg-bg-elevated shadow-xl z-30 p-1 animated fadeIn space-y-0.5">
                    <button
                      onClick={openRenameDialog}
                      className="w-full text-left px-3 py-2 rounded-md text-xs transition-colors flex items-center gap-2 text-text-primary hover:bg-bg-input"
                    >
                      <Edit2 size={12} />
                      Rename mode
                    </button>
                    <button
                      onClick={openDeleteDialog}
                      disabled={saving || modes.length <= 1}
                      className={`w-full text-left px-3 py-2 rounded-md text-xs transition-colors flex items-center gap-2 ${
                        saving || modes.length <= 1
                          ? 'text-text-tertiary cursor-not-allowed'
                          : 'text-red-400 hover:bg-red-500/10'
                      }`}
                    >
                      <Trash2 size={12} />
                      Delete mode
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="text-base font-semibold text-text-primary">Real-time prompt</div>
              <button
                onClick={() => { setGenError(''); setIsGenOpen((v) => !v); }}
                className="inline-flex items-center gap-1 text-xs text-text-tertiary hover:text-text-primary transition-colors"
                title="Generate this prompt from a short description"
              >
                <Sparkles size={12} className="text-accent-primary" />
                Generate with AI
              </button>
            </div>

            {isGenOpen && (
              <div className="rounded-xl border border-accent-primary/30 bg-bg-elevated p-3 space-y-2">
                <textarea
                  value={genDesc}
                  onChange={(e) => setGenDesc(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void handleGenerate(); }
                  }}
                  placeholder="Describe this mode in a sentence — e.g. interview copilot for a senior backend role; concise STAR answers in my own voice, calm and confident."
                  className="w-full h-16 resize-none bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent-primary/50 custom-scrollbar"
                  spellCheck={false}
                  autoFocus
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] min-w-0 truncate">
                    {genError
                      ? <span className="text-red-500">{genError}</span>
                      : <span className="text-text-tertiary">Replaces the prompt below — you can edit after.</span>}
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => setIsGenOpen(false)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border-subtle bg-bg-input text-text-secondary hover:text-text-primary transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => void handleGenerate()}
                      disabled={generating || !genDesc.trim()}
                      className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors inline-flex items-center gap-1.5 ${
                        generating || !genDesc.trim()
                          ? 'bg-bg-input text-text-tertiary border border-border-subtle cursor-not-allowed'
                          : 'bg-text-primary text-bg-main hover:opacity-90'
                      }`}
                    >
                      <Sparkles size={12} />
                      {generating ? 'Generating…' : 'Generate'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="relative rounded-xl border border-border-subtle bg-bg-input transition-colors focus-within:border-accent-primary/50">
              <textarea
                value={selectedMode.prompt}
                onChange={(e) => updateSelectedMode({ prompt: e.target.value })}
                className="w-full h-[170px] md:h-[190px] resize-none overflow-y-auto bg-transparent rounded-xl px-4 py-3 pb-14 text-sm leading-relaxed text-text-primary placeholder-text-tertiary focus:outline-none custom-scrollbar"
                placeholder="Define this mode's speaking style and instructions..."
                spellCheck={false}
              />
              <button
                onClick={() => persistConfig(modes, activeModeId)}
                disabled={saving || !selectedMode.prompt.trim() || !isPromptDirty}
                className={`absolute bottom-3 right-3 px-4 py-2 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
                  saving || !selectedMode.prompt.trim() || !isPromptDirty
                    ? 'bg-bg-input text-text-tertiary cursor-not-allowed border border-border-subtle'
                    : 'bg-text-primary text-bg-main hover:opacity-90 shadow-sm'
                }`}
              >
                  <Save size={12} />
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>

          <div className="space-y-1.5">
            <div className="text-base font-semibold text-text-primary">Reference files</div>
            <div className="rounded-xl border border-border-subtle bg-bg-item-surface p-3">
              {(selectedMode.referenceFiles || []).length > 0 ? (
                <div className="space-y-1.5">
                  {(selectedMode.referenceFiles || []).map((file) => (
                    <div key={file.id} className="rounded-lg bg-bg-input px-3 py-2 flex items-center justify-between gap-3 min-h-[54px]">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-bg-elevated flex items-center justify-center shrink-0">
                          <FileText size={15} className="text-text-secondary" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-[13px] text-text-primary truncate">{file.name}</div>
                          <div className="text-[11px] text-text-tertiary">
                            {formatFileSize(file.size)}{file.text ? ' - Text indexed' : ' - Stored only'}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => void handleRemoveReferenceFile(file.id)}
                        disabled={saving || uploadingFiles}
                        className="w-7 h-7 rounded-md text-text-tertiary hover:text-red-400 hover:bg-red-500/10 transition-colors flex items-center justify-center shrink-0"
                        title="Remove reference file"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                  <div className="flex justify-center pt-1.5">
                    <button
                      onClick={() => void handleUploadReferenceFiles()}
                      disabled={uploadingFiles || saving}
                      className={`px-3 py-1.5 rounded-lg border border-border-subtle bg-bg-input text-xs transition-colors flex items-center gap-2 ${
                        uploadingFiles || saving
                          ? 'text-text-tertiary cursor-wait'
                          : 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated'
                      }`}
                    >
                      <Upload size={12} />
                      {uploadingFiles ? 'Uploading...' : 'Upload additional file'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg bg-bg-input px-3 py-2 flex items-center justify-between gap-3 min-h-[54px]">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-bg-elevated flex items-center justify-center shrink-0">
                      <FileText size={15} className="text-text-secondary" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[13px] text-text-primary truncate">No reference file uploaded yet</div>
                      <div className="text-[11px] text-text-tertiary">Add documents for richer mode context.</div>
                    </div>
                  </div>
                  <button
                    onClick={() => void handleUploadReferenceFiles()}
                    disabled={uploadingFiles || saving}
                    className={`px-3 py-1.5 rounded-lg text-xs transition-colors flex items-center gap-2 shrink-0 ${
                      uploadingFiles || saving
                        ? 'bg-bg-elevated text-text-tertiary cursor-wait'
                        : 'bg-bg-elevated text-text-secondary hover:text-text-primary hover:bg-bg-main'
                    }`}
                  >
                    <Upload size={12} />
                    {uploadingFiles ? 'Uploading...' : 'Upload file'}
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="text-base font-semibold text-text-primary">Notes template</div>
            <div className="rounded-xl border border-border-subtle bg-bg-item-surface p-4 text-center">
              <div className="text-[13px] text-text-tertiary">Add a custom formatting template for your notes.</div>
              <button className="mt-2 px-4 py-2 rounded-lg border border-border-subtle bg-bg-input text-text-secondary text-sm font-medium hover:text-text-primary hover:bg-bg-elevated transition-colors">
                + Add template
              </button>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 min-h-4">
            {statusMessage && <p className="text-[11px] text-emerald-500">{statusMessage}</p>}
            {errorMessage && <p className="text-[11px] text-red-500">{errorMessage}</p>}
          </div>

          {isRenameDialogOpen && (
            <div className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-4">
              <div className="w-full max-w-md rounded-xl border border-border-subtle bg-bg-elevated p-4 space-y-3 shadow-2xl">
                <h4 className="text-sm font-semibold text-text-primary">Rename mode</h4>
                <p className="text-xs text-text-secondary">Are you sure you want to rename this mode?</p>
                <input
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void confirmRenameMode();
                    }
                  }}
                  className="w-full h-10 rounded-lg border border-border-subtle bg-bg-input px-3 text-sm text-text-primary focus:outline-none focus:border-accent-primary/50"
                  placeholder="Mode name"
                  spellCheck={false}
                  autoFocus
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => setIsRenameDialogOpen(false)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border-subtle bg-bg-input text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => void confirmRenameMode()}
                    disabled={saving || !renameDraft.trim()}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      saving || !renameDraft.trim()
                        ? 'bg-bg-input text-text-tertiary border border-border-subtle cursor-not-allowed'
                        : 'bg-text-primary text-bg-main hover:opacity-90'
                    }`}
                  >
                    Rename
                  </button>
                </div>
              </div>
            </div>
          )}

          {isDeleteDialogOpen && (
            <div className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-4">
              <div className="w-full max-w-md rounded-xl border border-border-subtle bg-bg-elevated p-4 space-y-3 shadow-2xl">
                <h4 className="text-sm font-semibold text-text-primary">Delete mode</h4>
                <p className="text-xs text-text-secondary">
                  Are you sure you want to delete <span className="text-text-primary font-medium">{selectedMode.name}</span>?
                </p>
                <p className="text-[11px] text-text-tertiary">This action cannot be undone.</p>
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => setIsDeleteDialogOpen(false)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border-subtle bg-bg-input text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => void confirmDeleteMode()}
                    disabled={saving || modes.length <= 1}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      saving || modes.length <= 1
                        ? 'bg-bg-input text-text-tertiary border border-border-subtle cursor-not-allowed'
                        : 'bg-red-500/90 text-white hover:bg-red-500'
                    }`}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="text-sm text-text-secondary">Create a mode to get started.</div>
      )}
    </div>
  );
};

export default ManageModesSettings;
