import { useEffect, useRef, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { api, ApiError, setCsrf, identify, chunk, delay, type User, type Upload, type Job } from "./api";
import "./upload.css";
import logoUrl from "./logo.png";
import { CleanupDialog } from "./CleanupDialog";

function Icon({ name = "upload" }: { name?: "upload" | "file" | "shield" | "cpu" | "check" | "pause" }) {
  const paths = { upload: "M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5", file: "M14 3H5v18h14V8l-5-5v5h5M8 13h8M8 17h6", shield: "M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3m-4 9 3 3 5-6", cpu: "M6 6h12v12H6zM9 9h6v6H9zM9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4", check: "m5 12 4 4L19 6", pause: "M8 5v14m8-14v14" };
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>;
}
const presets = [
  { id: "review", title: "Bản duyệt", badge: "H.264 · 1080p", info: "File gọn, thuận tiện gửi duyệt và xem trên trình duyệt." },
  { id: "delivery", title: "Bản bàn giao", badge: "H.264 · Giữ kích thước", info: "Ưu tiên chất lượng, giữ độ phân giải của video nguồn." },
  { id: "compact", title: "Nén dung lượng", badge: "H.265 · Giữ kích thước", info: "Tiết kiệm dung lượng. Thiết bị phát cần hỗ trợ H.265." },
];
const size = (bytes: number) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
const statusNames: Record<string, string> = { QUEUED: "Đang chờ máy", ASSIGNED: "Đã phân công", RUNNING: "Đang encode", COMPLETED: "Hoàn tất", FAILED: "Thất bại", CANCELLED: "Đã hủy", PAUSED: "Tạm dừng" };

function Portal() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [loginError, setLoginError] = useState("");
  const [logging, setLogging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preset, setPreset] = useState("review");
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const [active, setActive] = useState<Upload | null>(null);
  const [phase, setPhase] = useState<"idle" | "checking" | "uploading" | "paused" | "retrying" | "submitting" | "done">("idle");
  const [loaded, setLoaded] = useState(0);
  const [bytesPerSecond, setBytesPerSecond] = useState(0);
  const [checked, setChecked] = useState(0);
  const [error, setError] = useState("");
  const [offline, setOffline] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [remove, setRemove] = useState<Upload | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [cleanup, setCleanup] = useState(false);
  const control = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const resumeTarget = useRef<Upload | null>(null);
  const sending = ["checking", "uploading", "retrying", "submitting"].includes(phase);
  async function me() {
    try { const info = await api<User>("/me"); setCsrf(info.csrf); setUser(info); }
    catch (e) { setUser(null); if (!(e instanceof ApiError && e.status === 401)) setLoginError("Cổng Upload chưa kết nối. Vui lòng thử lại."); }
  }
  useEffect(() => { void me(); return () => control.current?.abort(); }, []);
  useEffect(() => {
    if (!sending) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [sending]);
  useEffect(() => {
    if (!user) return;
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const list = await api<Upload[]>("/uploads");
        if (stopped) return;
        setUploads(list); setOffline(false);
        // Serial polling keeps load low even when many jobs are listed.
        for (const item of list.filter(u => u.jobId)) {
          if (stopped) return;
          try { const job = await api<Job>(`/uploads/${item.id}/job`); if (!stopped && job) setJobs(previous => ({ ...previous, [item.id]: job })); }
          catch (e) { if (e instanceof ApiError && e.status === 401) throw e; }
        }
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) { control.current?.abort(); setUser(null); setLoginError("Phiên đăng nhập đã hết hạn. Đăng nhập lại để tiếp tục."); }
        else if (!stopped) setOffline(true);
      } finally { if (!stopped) timer = setTimeout(poll, 7000); }
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [user]);
  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setLoginError(""); setLogging(true);
    const data = new FormData(e.currentTarget);
    try { await api("/login", "POST", { username: data.get("username"), password: data.get("password") }); await me(); }
    catch (e) { setLoginError(e instanceof Error ? e.message : "Không thể đăng nhập."); }
    finally { setLogging(false); }
  }
  function select(next: File | undefined) {
    if (!next || sending || !user) return;
    setError("");
    if (!/\.(mp4|mov|mkv|webm|avi|mxf)$/i.test(next.name) || next.size < 16 || next.size > user.maxFileBytes) { setError(`Chọn video đúng định dạng, tối đa ${size(user.maxFileBytes)}.`); return; }
    const target = resumeTarget.current;
    if (target && (target.name !== next.name || target.size !== next.size)) { setError("Hãy chọn đúng file nguồn của phiên cần tiếp tục."); return; }
    setFile(next); setActive(target); if (target) setPreset(target.preset);
    setLoaded(target?.offset ?? 0); setChecked(0); setPhase("idle");
  }
  async function start() {
    if (!file || !user || sending) return;
    const controller = new AbortController(); control.current = controller;
    const signal = controller.signal;
    setError(""); setPhase("checking"); setChecked(0); setBytesPerSecond(0);
    try {
      const existing = active ? await api<Upload>(`/uploads/${active.id}`) : null;
      const chunkBytes = existing?.chunkBytes ?? (await api<User>("/me")).chunkBytes;
      const identity = await identify(file, chunkBytes, signal, setChecked);
      signal.throwIfAborted();
      if (resumeTarget.current && identity.fingerprint !== resumeTarget.current.fingerprint) throw new Error("Nội dung file đã thay đổi. Không thể nối vào phiên cũ.");
      let current = existing ?? await api<Upload>("/uploads", "POST", { name: file.name, size: file.size, fingerprint: identity.fingerprint, preset, chunkBytes });
      if (current.fingerprint !== identity.fingerprint || current.chunkBytes !== chunkBytes) throw new Error("File không khớp với phiên upload.");
      setActive(current); let retries = 0;
      while (current.state === "uploading" && current.offset < file.size) {
        signal.throwIfAborted(); setPhase("uploading"); setLoaded(current.offset);
        try {
          const offset = current.offset;
          let sampledAt = performance.now(), sampledBytes = 0;
          current = await chunk(current, file, chunkBytes, identity.hashes[Math.floor(offset / chunkBytes)]!, signal, n => {
            setLoaded(offset + n);
            const now = performance.now(), elapsed = now - sampledAt;
            if (elapsed >= 1000) {
              setBytesPerSecond(Math.max(0, n - sampledBytes) * 1000 / elapsed);
              sampledAt = now; sampledBytes = n;
            }
          });
          setActive(current); setLoaded(current.offset); retries = 0;
        } catch (e) {
          if (signal.aborted) throw e;
          const status = e instanceof ApiError ? e.status : 0;
          if ([401, 403, 404, 413, 415, 507].includes(status) || ++retries > 6) throw e;
          setPhase("retrying"); setBytesPerSecond(0); await delay(Math.min(30_000, 1000 * 2 ** retries), signal);
          try { current = await api<Upload>(`/uploads/${current.id}`); }
          catch (syncError) { if (syncError instanceof ApiError && [401, 403, 404].includes(syncError.status)) throw syncError; }
        }
      }
      signal.throwIfAborted(); setPhase("submitting");
      current = await api<Upload>(`/uploads/${current.id}/complete`, "POST", {});
      setActive(current); setLoaded(file.size); setPhase("done");
      setUploads(await api<Upload[]>("/uploads"));
    } catch (e) {
      setPhase("paused");
      if (!signal.aborted) setError(e instanceof Error ? e.message : "Upload bị gián đoạn. Có thể tiếp tục từ phần đã lưu.");
    } finally { if (control.current === controller) control.current = null; }
  }
  function newFile() { setFile(null); setActive(null); resumeTarget.current = null; setPhase("idle"); setLoaded(0); setError(""); if (input.current) input.current.value = ""; }
  async function retrySubmit(item: Upload) {
    setActionBusy(true); setError("");
    try { await api(`/uploads/${item.id}/complete`, "POST", {}); setUploads(await api<Upload[]>("/uploads")); }
    catch (e) { setError(e instanceof Error ? e.message : "Chưa thể tạo job."); }
    finally { setActionBusy(false); }
  }
  const brand = <div className="up-brand"><img className="up-logo" src={logoUrl} alt="Dreamers" width="48" height="48"/><div>DREAMERS<span>UPLOAD & ENCODE</span></div></div>;
  if (user === undefined) return <main className="up-login">{brand}<p>Đang kết nối cổng Upload…</p></main>;
  if (!user) return <main className="up-login">{brand}<div className="up-login-card"><span className="up-kicker">KHÔNG GIAN GỬI FILE</span><h1>Đưa video vào<br/>luồng xử lý của studio.</h1><p>Upload an toàn. Theo dõi encode.<br/>Nhận kết quả tại một nơi.</p><form onSubmit={login}><label>Tài khoản<input name="username" autoComplete="username" required maxLength={100}/></label><label>Mật khẩu<input name="password" type="password" autoComplete="current-password" required maxLength={256}/></label>{loginError && <p className="up-error" role="alert">{loginError}</p>}<button className="up-primary" disabled={logging}>{logging ? "Đang đăng nhập…" : "Đăng nhập"}</button></form><small><Icon name="shield"/> Chỉ dành cho tài khoản được studio cấp quyền.</small></div></main>;
  const finished = uploads.filter(u => jobs[u.id]?.status === "COMPLETED").length;
  const encoding = uploads.filter(u => ["RUNNING", "ASSIGNED", "QUEUED"].includes(jobs[u.id]?.status ?? "")).length;
  const percent = file ? Math.min(100, Math.floor(loaded / file.size * 100)) : 0;
  const phaseText = { idle: "Sẵn sàng upload", checking: `Đang kiểm tra file · ${Math.round(checked * 100)}%`, uploading: "Đang upload", paused: "Đã tạm dừng", retrying: "Đang kết nối lại…", submitting: "Đang gửi vào hàng đợi…", done: "Đã nhận file · Theo dõi job bên dưới" }[phase];
  return <div className="up-app"><header className="up-header">{brand}<div className="up-account"><span className="up-connected"><i/>{offline ? "Đang kết nối lại" : "Phiên được xác thực"}</span><span className="up-avatar">{user.username.slice(0, 2).toUpperCase()}</span><span>{user.username}</span><button disabled={sending} onClick={async () => { try { await api("/logout", "POST", {}); setUser(null); setUploads([]); setJobs({}); newFile(); } catch { setError("Chưa thể đăng xuất, hãy thử lại."); } }}>Đăng xuất</button></div></header>
    <main className="up-main"><div className="up-heading"><div><span className="up-kicker">STUDIO / MEDIA DELIVERY</span><h1>Upload & Encode<span>.</span></h1><p>Gửi file lớn. Chọn bản xuất. Để studio xử lý phần còn lại.</p></div><div className="up-mode"><Icon name="cpu"/><div>Xử lý trên máy trạm<span>Qua hàng đợi Encode & Render</span></div></div></div>
      <div className="up-steps"><span className="current"><b>01</b> Upload video</span><i/><span><b>02</b> Encode trên máy trạm</span><i/><span><b>03</b> Nhận kết quả</span></div>
      {error && <div role="alert" className="up-error">{error}</div>}{offline && <div role="status" className="up-warning">Đang kết nối lại. File đã nhận vẫn được giữ trên hệ thống.</div>}
      <div className="up-workspace"><section className="up-panel up-source"><div className="up-section-title"><h2>Video nguồn</h2><span>01 / UPLOAD</span></div><input ref={input} type="file" className="up-file-input" aria-label="Chọn video nguồn" accept=".mp4,.mov,.mkv,.webm,.avi,.mxf" disabled={sending} onChange={e => select(e.target.files?.[0])}/>
        {!file ? <button className={`up-drop ${dragging ? "dragging" : ""}`} onClick={() => { resumeTarget.current = null; input.current?.click(); }} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); resumeTarget.current = null; select(e.dataTransfer.files[0]); }}><span className="up-upload-symbol"><Icon/></span><strong>Kéo video vào đây</strong><span>hoặc <em>chọn file từ máy tính</em></span><small>MP4, MOV, MKV, WEBM, AVI, MXF · Tối đa {size(user.maxFileBytes)}</small></button> : <div className="up-selected"><span className="up-file-symbol"><Icon name="file"/></span><div className="up-file-info"><strong>{file.name}</strong><span>{size(file.size)} · {presets.find(p => p.id === preset)?.title}</span></div><button disabled={sending} onClick={newFile} aria-label="Đổi file">Đổi file</button></div>}
        {file && <div className="up-transfer"><div><strong role="status">{phaseText}</strong><span>{phase === "checking" ? Math.round(checked * 100) : percent}%</span></div><progress aria-label="Tiến độ upload" max={100} value={phase === "checking" ? checked * 100 : percent}/><div><small>{size(loaded)} / {size(file.size)}{phase === "uploading" && bytesPerSecond > 0 && ` · ${bytesPerSecond >= 1024 ** 2 ? `${(bytesPerSecond / 1024 ** 2).toFixed(1)} MB/s` : `${Math.round(bytesPerSecond / 1024)} KB/s`}`}</small><small>{phase === "checking" ? "Kiểm tra nội dung trên máy bạn" : "Tiếp tục từ phần đã lưu khi mạng gián đoạn"}</small></div></div>}
        <div className="up-upload-notes"><div><Icon name="shield"/><span>File chỉ hiển thị sau khi đăng nhập tài khoản được cấp.</span></div><div><Icon name="pause"/><span>Có thể tạm dừng. Sau khi mở lại trang, chọn đúng file để tiếp tục.</span></div></div>
        <div className="up-submit"><span>{phase === "done" ? "Bạn có thể gửi thêm video." : "File nguồn được giữ nguyên."}</span>{sending ? <button onClick={() => control.current?.abort()} disabled={phase === "submitting"}>Tạm dừng</button> : phase === "done" ? <button className="up-primary" onClick={newFile}>Upload file tiếp</button> : <button className="up-primary" disabled={!file} onClick={() => void start()}><Icon/>{phase === "paused" || active ? "Tiếp tục upload" : "Upload & tạo job"}</button>}</div>
      </section><aside className="up-panel up-presets"><div className="up-section-title"><h2>Bản xuất</h2><span>02 / PRESET</span></div><p>Chọn mục đích sử dụng video.</p><div className="up-preset-list" role="radiogroup" aria-label="Preset encode">{presets.map(p => <button key={p.id} role="radio" aria-checked={preset === p.id} disabled={sending || !!active} className={`up-preset ${preset === p.id ? "selected" : ""}`} onClick={() => setPreset(p.id)}><div><strong>{p.title}</strong><span className="up-radio">{preset === p.id ? "●" : ""}</span></div><span>{p.badge}</span><p>{p.info}</p></button>)}</div><div className="up-compute"><Icon name="cpu"/><p>Encode bằng GPU trên máy trạm.<span>Máy bận? Job sẽ chờ máy phù hợp sẵn sàng.</span></p></div></aside></div>
      <section className="up-panel up-history"><div className="up-history-head"><div><span className="up-kicker">THEO DÕI CÔNG VIỆC</span><h2>File của bạn</h2></div><button disabled={sending || actionBusy} onClick={() => setCleanup(true)}>Dọn dẹp file</button><div className="up-summary"><span><b>{uploads.length}</b> file</span><span><b>{encoding}</b> đang xử lý / chờ</span><span><b>{finished}</b> hoàn tất</span></div></div>
        {!uploads.length ? <div className="up-empty"><Icon name="file"/><strong>File đầu tiên của bạn sẽ xuất hiện ở đây</strong><p>Upload video để bắt đầu. Tiến độ xử lý sẽ tự cập nhật.</p></div> : <div className="up-table-wrap"><table><thead><tr><th>FILE / BẢN XUẤT</th><th>TRẠNG THÁI</th><th>TIẾN ĐỘ</th><th>KẾT QUẢ</th></tr></thead><tbody>{uploads.map(item => { const job = jobs[item.id]; const progress = item.state === "uploading" ? item.offset / item.size * 100 : job?.progress ?? 0; return <tr key={item.id}><td><div className="up-name"><Icon name="file"/><div><strong>{item.name}</strong><small>{size(item.size)} · {presets.find(p => p.id === item.preset)?.title}{item.jobId ? ` · #${item.jobId}` : ""}</small></div></div></td><td><span className={`up-badge ${job?.status.toLowerCase() ?? item.state}`}>{item.state === "uploading" ? "Đang nhận file" : item.state === "submitting" || item.state === "ready" ? "Đang xác nhận job" : statusNames[job?.status ?? ""] ?? "Đang đồng bộ"}</span>{job?.error && <small className="up-job-error">{job.error}</small>}</td><td><span>{Math.round(progress)}%{job?.etaSeconds != null && job.status === "RUNNING" ? ` · Còn ${Math.ceil(job.etaSeconds / 60)} phút` : ""}</span><progress max={100} value={progress} aria-label={`Tiến độ ${item.name}`}/></td><td><div className="up-row-actions">{job?.status === "COMPLETED" && <a href={`/upload/api/uploads/${item.id}/output`}>Tải kết quả ↓</a>}{item.state === "uploading" && <button disabled={sending} onClick={() => { resumeTarget.current = item; if (input.current) { input.current.value = ""; input.current.click(); } }}>Tiếp tục</button>}{["ready", "submitting"].includes(item.state) && <button disabled={actionBusy} onClick={() => void retrySubmit(item)}>Xác nhận lại</button>}{(item.state === "uploading" || ["COMPLETED", "FAILED"].includes(job?.status ?? "")) && <button disabled={sending || actionBusy} onClick={() => setRemove(item)}>Xóa file</button>}</div></td></tr>; })}</tbody></table></div>}
      </section><footer className="up-footer"><span>DREAMERS STUDIO · UPLOAD & ENCODE</span><span>Phiên upload chưa hoàn tất được giữ {user.incompleteTtlHours} giờ.</span></footer>
    </main>{cleanup && <CleanupDialog onClose={() => setCleanup(false)} onDeleted={ids => { setUploads(previous => previous.filter(item => !ids.includes(item.id))); if (active && ids.includes(active.id)) newFile(); }}/>}{remove && <div className="up-modal-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="remove-title" className="up-modal"><h2 id="remove-title">Xóa file này?</h2><p>File nguồn và kết quả của <strong>{remove.name}</strong> sẽ bị xóa khỏi kho Upload. Hãy tải kết quả trước khi xóa.</p><div><button disabled={actionBusy} autoFocus onClick={() => setRemove(null)}>Giữ lại</button><button className="up-danger" disabled={actionBusy} onClick={async () => { setActionBusy(true); try { await api(`/uploads/${remove.id}`, "DELETE"); setUploads(await api<Upload[]>("/uploads")); if (active?.id === remove.id) newFile(); setRemove(null); } catch (e) { setError(e instanceof Error ? e.message : "Chưa thể xóa file."); setRemove(null); } finally { setActionBusy(false); } }}>Xóa nguồn và kết quả</button></div></section></div>}
  </div>;
}
createRoot(document.getElementById("root")!).render(<Portal/>);
