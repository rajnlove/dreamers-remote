// 15-30s per the Phase 2 spec's heartbeat-freshness rule; 20s is the
// midpoint, giving one full heartbeat interval (5s default) of slack
// before flipping to offline.
const AGENT_OFFLINE_THRESHOLD_MS = 20_000;

export function isAgentOnline(lastSeen: string | null): boolean {
  if (!lastSeen) return false;
  return Date.now() - new Date(lastSeen).getTime() < AGENT_OFFLINE_THRESHOLD_MS;
}
