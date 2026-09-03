import { useState, type FormEvent } from "react";
import { login, type CurrentUser } from "../api/auth";
import { useLanguage } from "../i18n/LanguageContext";
import LanguageToggle from "../components/LanguageToggle";

interface Props {
  onLogin: (user: CurrentUser) => void;
}

export default function Login({ onLogin }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { t } = useLanguage();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const user = await login(username, password);
      onLogin(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="app login-wrap">
      <LanguageToggle className="login-lang-toggle" />
      <form className="password-form login-form" onSubmit={handleSubmit}>
        <h1 className="login-title">{t("loginTitle")}</h1>
        <label htmlFor="username">{t("loginUsername")}</label>
        <input
          id="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
        />
        <label htmlFor="login-password">{t("loginPassword")}</label>
        <input
          id="login-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="login-error">{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={submitting}>
          {submitting ? t("loginSubmitting") : t("loginButton")}
        </button>
      </form>
    </div>
  );
}
