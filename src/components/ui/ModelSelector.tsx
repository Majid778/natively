import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Monitor } from 'lucide-react';

const GEMINI_FLASH_OPENROUTER_PROVIDER_ID = 'openrouter-google-gemini-2-5-flash';
const GEMINI_FLASH_OPENROUTER_DISPLAY = 'OpenRouter (Google Gemini 2.5 Flash)';

interface ModelSelectorProps {
    currentModel: string;
    onSelectModel: (model: string) => void;
}

interface CustomProvider {
    id: string;
    name: string;
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({ currentModel, onSelectModel }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [geminiProvider, setGeminiProvider] = useState<CustomProvider | null>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        const loadProvider = async () => {
            try {
                const providers = await window.electronAPI?.getCustomProviders?.() as CustomProvider[] | undefined;
                setGeminiProvider(providers?.find((provider) => provider.id === GEMINI_FLASH_OPENROUTER_PROVIDER_ID) || null);
            } catch (error) {
                console.error('Failed to load Gemini Flash provider:', error);
            }
        };

        loadProvider();
        if (isOpen) loadProvider();
    }, [isOpen]);

    const handleSelect = () => {
        onSelectModel(GEMINI_FLASH_OPENROUTER_PROVIDER_ID);
        setIsOpen(false);
    };

    const displayName = currentModel === GEMINI_FLASH_OPENROUTER_PROVIDER_ID || geminiProvider
        ? GEMINI_FLASH_OPENROUTER_DISPLAY
        : 'Set up Gemini Flash';

    const isSelected = currentModel === GEMINI_FLASH_OPENROUTER_PROVIDER_ID;

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-2 px-3 py-1.5 bg-bg-input hover:bg-bg-elevated border border-border-subtle rounded-lg transition-colors text-xs font-medium text-text-primary max-w-[270px]"
                title={displayName}
            >
                <span className="truncate">{displayName}</span>
                <ChevronDown size={14} className={`shrink-0 text-text-secondary transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <div className="absolute bottom-full left-0 mb-2 w-72 bg-bg-item-surface border border-border-subtle rounded-xl shadow-xl z-50 overflow-hidden animated fadeIn">
                    <div className="p-2">
                        {geminiProvider ? (
                            <button
                                onClick={handleSelect}
                                className={`w-full flex items-center justify-between p-2 rounded-lg transition-colors group ${isSelected ? 'bg-accent-primary/10' : 'hover:bg-bg-input'}`}
                            >
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className={`p-1.5 rounded-md ${isSelected ? 'bg-accent-primary/20 text-accent-primary' : 'bg-bg-elevated text-text-secondary group-hover:text-text-primary'}`}>
                                        <Monitor size={14} />
                                    </div>
                                    <div className="text-left min-w-0">
                                        <div className={`text-xs font-medium truncate max-w-[190px] ${isSelected ? 'text-accent-primary' : 'text-text-primary'}`}>
                                            {GEMINI_FLASH_OPENROUTER_DISPLAY}
                                        </div>
                                        <div className="text-[10px] text-text-tertiary">Fixed app model</div>
                                    </div>
                                </div>
                                {isSelected && <Check size={14} className="text-accent-primary" />}
                            </button>
                        ) : (
                            <div className="text-center py-6 text-text-tertiary">
                                <p className="text-xs mb-2">Gemini Flash is not configured.</p>
                                <p className="text-[10px] opacity-70">Add your OpenRouter key in Settings.</p>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
