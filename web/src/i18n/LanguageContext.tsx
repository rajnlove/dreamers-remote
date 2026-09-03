import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { translations, type Lang, type TranslationKey } from "./translations";

const STORAGE_KEY = "dreamers-remote-lang";

function detectDefaultLang(): Lang {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "vi") return stored;
  } catch {
    // localStorage can throw in some contexts (private browsing, etc.) --
    // fall through to language detection instead of failing to render.
  }
  return navigator.language.toLowerCase().startsWith("vi") ? "vi" : "en";
}

interface LanguageContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => {
    try {
      return detectDefaultLang();
    } catch {
      return "en";
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // Best-effort persistence only -- not having it just means the
      // language resets to auto-detect next visit, not a broken app.
    }
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo<LanguageContextValue>(
    () => ({
      lang,
      setLang,
      t: (key, vars) => {
        let text: string = translations[lang][key] ?? translations.en[key] ?? key;
        if (vars) {
          for (const [name, replacement] of Object.entries(vars)) {
            text = text.replaceAll(`{${name}}`, String(replacement));
          }
        }
        return text;
      },
    }),
    [lang],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within a LanguageProvider");
  return ctx;
}
