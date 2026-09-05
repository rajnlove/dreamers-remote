export const CHUNK_MAX_MS = 10 * 60_000;
export const CHUNK_IDLE_MS = 90_000;

// A slow stream may exceed 90 seconds while still making useful progress.
// Keep both an inactivity deadline and a bounded total lifetime.
export function transferDeadline(expire: (reason: string) => void) {
  let closed = false;
  let idle: ReturnType<typeof setTimeout>;
  const close = () => { closed = true; clearTimeout(idle); clearTimeout(total); };
  const stop = (reason: string) => { if (!closed) { close(); expire(reason); } };
  const total = setTimeout(() => stop("Chunk maximum duration exceeded"), CHUNK_MAX_MS);
  const progress = () => {
    if (closed) return;
    clearTimeout(idle);
    idle = setTimeout(() => stop("Chunk stalled without data"), CHUNK_IDLE_MS);
  };
  progress();
  return { progress, close };
}
