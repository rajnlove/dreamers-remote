import { useEffect, useRef, useState } from "react";
import { api } from "./api";

type Item = { id: string; name: string; bytes: number; allowed: boolean; reason: string };
type Result = { id: string; deleted: boolean; bytes: number; reason?: string };
const size = (n: number) => n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : `${(n / 1024 ** 2).toFixed(1)} MB`;

export function CleanupDialog({ onClose, onDeleted }: { onClose: () => void; onDeleted: (ids: string[]) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result[]>([]);
  async function refresh() {
    setLoading(true); setError(""); setSelected([]); setConfirm(false);
    try { setItems(await api<Item[]>("/cleanup")); }
    catch (e) { setError(e instanceof Error ? e.message : "Chưa thể kiểm tra kho file."); }
    finally { setLoading(false); }
  }
  useEffect(() => { dialog.current?.showModal(); void refresh(); }, []);
  const chosen = items.filter(item => selected.includes(item.id));
  const bytes = chosen.reduce((n, item) => n + item.bytes, 0);
  async function clean() {
    setBusy(true); setError(""); setResult([]);
    const done: Result[] = [];
    // One bounded request per file remains compatible with Cloudflare timeouts.
    for (const item of chosen) {
      try {
        const response = await api<{ results: Result[] }>("/cleanup", "POST", { ids: [item.id] });
        done.push(...response.results);
        onDeleted(response.results.filter(r => r.deleted).map(r => r.id));
      } catch (e) { done.push({ id: item.id, deleted: false, bytes: 0, reason: e instanceof Error ? e.message : "Mất kết nối; làm mới để kiểm tra lại." }); }
      setResult([...done]);
    }
    setItems(previous => previous.filter(item => !done.some(r => r.id === item.id && r.deleted)));
    setSelected([]); setConfirm(false); setBusy(false);
  }
  return <dialog ref={dialog} className="up-cleanup" aria-labelledby="cleanup-title" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <header><div><span className="up-kicker">KHO UPLOAD</span><h2 id="cleanup-title">Dọn dẹp file</h2></div><button aria-label="Đóng dọn dẹp" disabled={busy} onClick={onClose}>×</button></header>
    <p>Chọn file không còn cần giữ. Dọn dẹp sẽ xóa cả nguồn và kết quả; hãy tải bản cần lưu trước.</p>
    {error && <p role="alert" className="up-error">{error}</p>}
    {loading ? <p role="status">Đang kiểm tra file và trạng thái xử lý…</p> : <>
      {!confirm && <div className="up-cleanup-tools"><button disabled={busy} onClick={() => setSelected(items.filter(i => i.allowed).map(i => i.id))}>Chọn file có thể dọn</button><button disabled={busy} onClick={() => setSelected(items.filter(i => i.allowed && /^(deployment-smoke-|farm-acceptance-|driver-recheck-|acceptance-inherited-permissions)/.test(i.name)).map(i => i.id))}>Chọn file test</button><button disabled={busy} onClick={() => setSelected([])}>Bỏ chọn</button><button disabled={busy} onClick={() => void refresh()}>Làm mới</button></div>}
      <div className="up-cleanup-list">{(confirm ? chosen : items).map(item => <label key={item.id} className="up-cleanup-item"><input type="checkbox" aria-label={`Chọn ${item.name}`} checked={selected.includes(item.id)} disabled={!item.allowed || busy || confirm} onChange={e => setSelected(previous => e.target.checked ? [...previous, item.id] : previous.filter(id => id !== item.id))}/><span><strong>{item.name}</strong><small>{item.reason}</small></span><b>{size(item.bytes)}</b></label>)}{!items.length && <p>Không còn file trong kho Upload.</p>}</div>
      {!!result.length && <div role="status" className="up-cleanup-result">Đã dọn {result.filter(r => r.deleted).length} file · Giải phóng {size(result.reduce((n, r) => n + r.bytes, 0))}{result.filter(r => !r.deleted).map(r => <p key={r.id}>{items.find(i => i.id === r.id)?.name}: {r.reason}</p>)}</div>}
      {confirm && <p className="up-warning">Xác nhận xóa vĩnh viễn {chosen.length} file đã chọn cùng các kết quả encode? Thao tác này không thể hoàn tác.</p>}
      <footer><span>{chosen.length} file đã chọn · {size(bytes)}</span><div><button disabled={busy} onClick={() => confirm ? setConfirm(false) : onClose()}>{confirm ? "Quay lại" : "Đóng"}</button><button className={confirm ? "up-danger" : "up-primary"} disabled={busy || !chosen.length} onClick={() => confirm ? void clean() : setConfirm(true)}>{busy ? "Đang dọn…" : confirm ? "Xóa nguồn và kết quả" : "Xem lại và dọn"}</button></div></footer>
    </>}
  </dialog>;
}
