import { useLanguage } from "../i18n/LanguageContext";

export default function LanguageToggle({ className = "" }: { className?: string }) {
  const { lang, setLang, t } = useLanguage();

  return (
    <div className={`lang-toggle ${className}`} role="group" aria-label={t("languageLabel")}>
      <button
        type="button"
        className={lang === "en" ? "active" : ""}
        aria-pressed={lang === "en"}
        onClick={() => setLang("en")}
      >
        EN
      </button>
      <button
        type="button"
        className={lang === "vi" ? "active" : ""}
        aria-pressed={lang === "vi"}
        onClick={() => setLang("vi")}
      >
        VI
      </button>
    </div>
  );
}
