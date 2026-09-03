import { useEffect, useRef, useState, type FormEvent } from "react";
import { createWorkstation } from "../api/workstations";
import type { Workstation } from "../types/workstation";
import StudioIcon from "./StudioIcon";
import { useLanguage } from "../i18n/LanguageContext";

export default function AddWorkstationDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (workstation: Workstation) => void }) {
  const { t } = useLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const field = (key: string) => String(form.get(key) ?? "").trim();
    setSaving(true);
    setError(null);
    try {
      const workstation = await createWorkstation({
        name: field("name"),
        hostname: field("hostname"),
        ip: field("ip"),
        mac_address: field("mac").toUpperCase(),
        vnc_port: Number(field("port")),
        ...(field("location") ? { location: field("location") } : {}),
      });
      onCreated(workstation);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="studio-dialog"
      aria-labelledby="add-workstation-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) onClose();
      }}
    >
      <form onSubmit={handleSubmit}>
        <header>
          <div>
            <span className="studio-eyebrow">{t("expandWorkspace")}</span>
            <h2 id="add-workstation-title">{t("addWorkstationTitle")}</h2>
          </div>
          <button type="button" className="studio-icon-button" aria-label={t("close")} disabled={saving} onClick={onClose}>
            <StudioIcon name="close" />
          </button>
        </header>
        <p>{t("addWorkstationSubtitle")}</p>
        {error && (
          <div className="studio-alert" role="alert">
            {error}
          </div>
        )}
        <fieldset disabled={saving}>
          <label>
            {t("fieldDisplayName")}
            <input name="name" placeholder="e.g. RENDER-05" maxLength={100} required autoFocus />
          </label>
          <label>
            {t("fieldHostname")}
            <input name="hostname" placeholder={t("fieldHostnamePlaceholder")} maxLength={253} required />
          </label>
          <label>
            {t("fieldIp")}
            <input name="ip" placeholder="192.168.1.100" inputMode="decimal" required pattern="[0-9]{1,3}(\.[0-9]{1,3}){3}" />
          </label>
          <label>
            {t("fieldVncPort")}
            <input name="port" type="number" min="1" max="65535" step="1" defaultValue="5900" required />
          </label>
          <label>
            {t("fieldMac")}
            <input name="mac" placeholder="AA:BB:CC:DD:EE:FF" pattern="([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}" required />
            <small>{t("fieldMacHint")}</small>
          </label>
          <label>
            <span className="studio-field-label">{t("fieldLocation")} <span>{t("optional")}</span></span>
            <input name="location" placeholder="e.g. Edit suite" maxLength={100} />
          </label>
        </fieldset>
        <p className="studio-dialog-note">{t("addWorkstationNote")}</p>
        <footer>
          <button className="studio-button" type="button" disabled={saving} onClick={onClose}>
            {t("cancel")}
          </button>
          <button className="studio-button primary" disabled={saving} type="submit">
            <StudioIcon name="plus" />
            {saving ? t("adding") : t("addWorkstationTitle")}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
