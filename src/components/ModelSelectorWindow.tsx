import React, { useEffect, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { useResolvedTheme } from '../hooks/useResolvedTheme';

const GEMINI_FLASH_OPENROUTER_PROVIDER_ID = 'openrouter-google-gemini-2-5-flash';
const GEMINI_FLASH_OPENROUTER_DISPLAY = 'OpenRouter (Google Gemini 2.5 Flash)';

interface ModelOption {
    id: string;
    name: string;
}

const ModelSelectorWindow = () => {
    const isLight = useResolvedTheme() === 'light';
    const [currentModel, setCurrentModel] = useState<string>(() => localStorage.getItem('cached-current-model') || '');
    const [availableModels, setAvailableModels] = useState<ModelOption[]>(() => {
        try {
            const cached = localStorage.getItem('cached-models');
            return cached ? JSON.parse(cached) : [];
        } catch {
            return [];
        }
    });
    const [isLoading, setIsLoading] = useState<boolean>(() => availableModels.length === 0);

    useEffect(() => {
        const loadModels = async () => {
            try {
                if (availableModels.length === 0) {
                    setIsLoading(true);
                }

                const customProviders = await window.electronAPI?.getCustomProviders?.() || [];
                const models: ModelOption[] = customProviders
                    .filter((provider: any) => provider.id === GEMINI_FLASH_OPENROUTER_PROVIDER_ID)
                    .map(() => ({
                        id: GEMINI_FLASH_OPENROUTER_PROVIDER_ID,
                        name: GEMINI_FLASH_OPENROUTER_DISPLAY,
                    }));

                localStorage.setItem('cached-models', JSON.stringify(models));
                setAvailableModels(models);

                const config = await window.electronAPI?.getCurrentLlmConfig?.();
                if (config?.model) {
                    setCurrentModel(config.model);
                    localStorage.setItem('cached-current-model', config.model);
                }
            } catch (err) {
                console.error('Failed to load models:', err);
            } finally {
                setIsLoading(false);
            }
        };

        loadModels();
        window.addEventListener('focus', loadModels);

        const unsubscribe = window.electronAPI?.onModelChanged?.((modelId: string) => {
            setCurrentModel(modelId);
            localStorage.setItem('cached-current-model', modelId);
        });

        return () => {
            unsubscribe?.();
            window.removeEventListener('focus', loadModels);
        };
    }, []);

    const handleSelectFn = (modelId: string) => {
        setCurrentModel(modelId);
        localStorage.setItem('cached-current-model', modelId);
        window.electronAPI?.setModel(modelId).catch((err: any) => console.error('Failed to set model:', err));
    };

    const panelClass = isLight
        ? 'bg-[#F3F4F6]/92 border-black/10 shadow-black/10'
        : 'bg-[#1E1E1E]/80 border-white/10 shadow-black/40';

    return (
        <div className="w-fit h-fit bg-transparent flex flex-col">
            <div className={`w-[300px] h-[132px] backdrop-blur-md border rounded-[16px] overflow-hidden shadow-2xl p-2 flex flex-col animate-scale-in origin-top-left ${panelClass}`}>
                {isLoading ? (
                    <div className={`flex items-center justify-center py-4 ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                        <span className="text-xs">Loading model...</span>
                    </div>
                ) : availableModels.length === 0 ? (
                    <div className={`px-4 py-4 text-center text-xs ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>
                        Gemini Flash is not configured.<br />Check Settings.
                    </div>
                ) : (
                    <div className="flex-1 overflow-y-auto scrollbar-hide flex flex-col gap-0.5">
                        {availableModels.map((model) => {
                            const isSelected = currentModel === model.id;
                            return (
                                <button
                                    key={model.id}
                                    onClick={() => handleSelectFn(model.id)}
                                    className={`w-full text-left px-3 py-2 flex items-center justify-between group transition-colors duration-200 rounded-lg ${
                                        isSelected
                                            ? (isLight ? 'bg-black/[0.07] text-slate-900' : 'bg-white/10 text-white')
                                            : (isLight ? 'text-slate-500 hover:bg-black/[0.04] hover:text-slate-800' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200')
                                    }`}
                                    title={model.name}
                                >
                                    <span className="text-[12px] font-medium truncate flex-1 min-w-0">{model.name}</span>
                                    {isSelected && <Check className={`w-3.5 h-3.5 shrink-0 ml-2 ${isLight ? 'text-emerald-600' : 'text-emerald-400'}`} />}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

export default ModelSelectorWindow;
