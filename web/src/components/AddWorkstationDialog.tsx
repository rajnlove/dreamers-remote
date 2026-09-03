import { useEffect, useRef, useState, type FormEvent } from "react";
import { createWorkstation } from "../api/workstations";
import type { Workstation } from "../types/workstation";
import StudioIcon from "./StudioIcon";

export default function AddWorkstationDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (workstation: Workstation) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { dialog.current?.showModal(); }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const field = (key: string) => String(form.get(key) ?? "").trim();
    setSaving(true);
    setError(null);
    try {
      const workstation = await createWorkstation({
        name: field("name"), hostname: field("hostname"), ip: field("ip"),
        mac_address: field("mac").toUpperCase(), vnc_port: Number(field("port")),
        ...(field("location") ? { location: field("location") } : {}),
      });
      onCreated(workstation);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setSaving(false); }
  }

  return (
    <dialog ref={dialog} className="studio-dialog" aria-labelledby="add-workstation-title" onCancel={event => { event.preventDefault(); if (!saving) onClose(); }}>
      <form onSubmit={handleSubmit}>
        <header><div><span className="studio-eyebrow">EXPAND YOUR WORKSPACE</span><h2 id="add-workstation-title">Add workstation</h2></div><button type="button" className="studio-icon-button" aria-label="Close add workstation" disabled={saving} onClick={onClose}><StudioIcon name="close" /></button></header>
        <p>Register a machine on your studio network.</p>
        {error && <div className="studio-alert" role="alert">{error}</div>}
        <fieldset disabled={saving}>
          <label>Display name<input name="name" placeholder="e.g. RENDER-05" maxLength={100} required autoFocus /></label>
          <label>Hostname<input name="hostname" placeholder="Windows computer name" maxLength={253} required /></label>
          <label>IPv4 address<input name="ip" placeholder="192.168.1.100" inputMode="decimal" required pattern="[0-9]{1,3}(\.[0-9]{1,3}){3}" /></label>
          <label>VNC port<input name="port" type="number" min="1" max="65535" step="1" defaultValue="5900" required /></label>
          <label>MAC address<input name="mac" placeholder="AA:BB:CC:DD:EE:FF" pattern="([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}" required /><small>Used to wake this machine over the network.</small></label>
          <label>Location <span>(optional)</span><input name="location" placeholder="e.g. Edit suite" maxLength={100} /></label>
        </fieldset>
        <p className="studio-dialog-note">UltraVNC enables remote access. Pair Dreamers Agent to report hardware metrics.</p>
        <footer><button className="studio-button" type="button" disabled={saving} onClick={onClose}>Cancel</button><button className="studio-button primary" disabled={saving} type="submit"><StudioIcon name="plus" />{saving ? "Adding…" : "Add workstation"}</button></footer>
      </form>
    </dialog>
  );
}
