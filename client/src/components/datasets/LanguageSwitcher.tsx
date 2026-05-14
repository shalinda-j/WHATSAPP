import { Check } from 'lucide-react';

export type Language = 'en' | 'si' | 'ta';

interface LanguageSwitcherProps {
  currentLanguage: Language;
  onLanguageChange: (lang: Language) => void;
  translatedLanguages?: Language[];
  size?: 'sm' | 'md';
}

const languageConfig = {
  en: {
    flag: '🇬🇧',
    label: 'EN',
    fullLabel: 'English',
  },
  si: {
    flag: '🇱🇰',
    label: 'SI',
    fullLabel: 'සිංහල',
  },
  ta: {
    flag: '🇮🇳',
    label: 'TA',
    fullLabel: 'தமிழ்',
  },
};

export default function LanguageSwitcher({
  currentLanguage,
  onLanguageChange,
  translatedLanguages = [],
  size = 'md',
}: LanguageSwitcherProps) {
  const sizeClasses = size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-2 text-sm';

  return (
    <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
      {(Object.keys(languageConfig) as Language[]).map((lang) => {
        const config = languageConfig[lang];
        const isActive = currentLanguage === lang;
        const isTranslated = translatedLanguages.includes(lang);

        return (
          <button
            key={lang}
            onClick={() => onLanguageChange(lang)}
            className={`
              relative flex items-center gap-1.5 rounded-md font-medium transition-all
              ${sizeClasses}
              ${
                isActive
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-800 hover:bg-gray-50'
              }
            `}
            title={config.fullLabel}
          >
            <span className="text-base">{config.flag}</span>
            <span>{config.label}</span>
            {isTranslated && !isActive && (
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full flex items-center justify-center">
                <Check className="w-2 h-2 text-white" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
