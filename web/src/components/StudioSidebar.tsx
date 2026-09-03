import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import StudioIcon, { type StudioIconName } from "./StudioIcon";
import { useLanguage } from "../i18n/LanguageContext";
import type { TranslationKey } from "../i18n/translations";
import type { Job } from "../types/job";
import "./StudioSidebar.css";

interface Props { ready: boolean; error?: boolean; total: number; online: number; jobs: Job[] | null; jobsError?: boolean; }
const sections: { id: string; label: TranslationKey; icon: StudioIconName }[] = [
  { id: "dashboard", label: "navDashboard", icon: "dashboard" },
  { id: "workstations", label: "navWorkstations", icon: "monitor" },
  { id: "monitoring", label: "navMonitoring", icon: "pulse" },
  { id: "activity", label: "navJobActivity", icon: "clock" },
];
export default function StudioSidebar({ ready, error = false, total, online, jobs, jobsError = false }: Props) {
  const { t } = useLanguage();
  const location = useLocation();
  const jobsReady = jobs !== null && !jobsError;
  const running = jobsReady ? jobs.filter(job => job.status === "RUNNING").length : "—";
  const pending = jobsReady ? jobs.filter(job => job.status === "QUEUED" || job.status === "ASSIGNED").length : "—";
  const failed = jobsReady ? jobs.filter(job => job.status === "FAILED").length : "—";
  const connected = ready && !error && jobsReady;
  const jobsPage = location.pathname === "/jobs";
  const section = location.hash.slice(1) || "dashboard";
  useEffect(() => {
    if (location.pathname === "/" && location.hash) {
      document.getElementById(location.hash.slice(1))?.scrollIntoView();
    }
  }, [location.pathname, location.hash]);
  return (
    <aside className="shared-sidebar" aria-label="Main navigation">
      <Link to="/" className="shared-brand">
        <svg width="36" height="38" viewBox="0 0 36 38" fill="none" aria-hidden="true">
          <path d="m18 2 14 8v18l-14 8-14-8V10L18 2Z" fill="#2678ed" />
          <path d="m18 11 6 3.5v9L18 27l-8-4.5v-7L18 11Z" fill="#0d1520" />
          <path d="m4 10 9 5v8l-9 5V10Z" fill="#609eff" />
        </svg><span>DREAMERS<small>REMOTE</small></span>
      </Link>
      <nav>
        {sections.map(item => <Link key={item.id} to={{ pathname: "/", hash: `#${item.id}` }} className={`shared-nav ${!jobsPage && section === item.id ? "active" : ""}`} aria-current={!jobsPage && section === item.id ? "location" : undefined}><StudioIcon name={item.icon} />{t(item.label)}</Link>)}
        <Link to="/jobs" className={`shared-nav ${jobsPage ? "active" : ""}`} aria-current={jobsPage ? "page" : undefined}><StudioIcon name="queue" />{t("navRenderQueue")}</Link>
      </nav>
      <div className="shared-sidebar-bottom">
        <div className="shared-system">
          <strong><span className={`shared-dot ${connected ? "online" : ""}`} />{t("systemStatusLabel")}</strong>
          <p>{error || jobsError ? t("connectionNeedsAttention") : connected ? t("connectedToStudio") : t("systemStatusConnecting")}</p>
          <dl className="shared-system-metrics">
            <div><dt>{t("onlineMachines")}</dt><dd>{ready && !error ? `${online} / ${total}` : "—"}</dd></div>
            <div><dt>{t("runningJobs")}</dt><dd>{running}</dd></div>
            <div><dt>{t("pendingJobs")}</dt><dd>{pending}</dd></div>
            <div><dt>{t("failedJobs")}</dt><dd className="shared-failed-count">{failed}</dd></div>
          </dl>
        </div>
        <div className="shared-version">{t("productName")}<span>{t("productTagline")}</span></div>
      </div>
    </aside>
  );
}

