import type { ReactNode } from "react";

export type StudioIconName = "dashboard" | "monitor" | "pulse" | "clock" | "queue" | "refresh" | "plus" | "cpu" | "memory" | "network" | "logout" | "arrow" | "close" | "power" | "check";
const paths: Record<StudioIconName, ReactNode> = {
  dashboard: <><rect x="3" y="3" width="7" height="7" rx="1.4" /><rect x="14" y="3" width="7" height="7" rx="1.4" /><rect x="3" y="14" width="7" height="7" rx="1.4" /><rect x="14" y="14" width="7" height="7" rx="1.4" /></>,
  monitor: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /></>,
  pulse: <path d="M2 12h5l3-8 4 16 3-8h5" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  queue: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
  refresh: <><path d="M20 7V3l-3 3a8 8 0 0 0-13 5M4 17v4l3-3a8 8 0 0 0 13-5M16 7h4M4 17h4" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  cpu: <><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4" /><rect x="9" y="9" width="6" height="6" rx="1" /></>,
  memory: <><rect x="3" y="4" width="18" height="6" rx="1.5" /><rect x="3" y="14" width="18" height="6" rx="1.5" /><path d="M7 7h.01M7 17h.01M16 7h2m-2 10h2" /></>,
  network: <><rect x="9" y="2" width="6" height="5" rx="1" /><rect x="2" y="17" width="6" height="5" rx="1" /><rect x="16" y="17" width="6" height="5" rx="1" /><path d="M12 7v5M5 17v-5h14v5" /></>,
  logout: <><path d="M9 4H4v16h5m6-12 4 4-4 4m-6-4h10" /></>,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  power: <><path d="M12 2v10M6 5a9 9 0 1 0 12 0" /></>,
  check: <path d="m5 12 4 4L19 6" />,
};

export default function StudioIcon({ name, className = "" }: { name: StudioIconName; className?: string }) {
  return <svg className={`studio-icon ${className}`} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
