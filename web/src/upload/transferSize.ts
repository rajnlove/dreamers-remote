const MIB = 1024 ** 2;
export const INITIAL_TRANSFER_BYTES = 4 * MIB;

// Aim for requests shorter than 20 seconds instead of relying on proxy deadlines.
export function nextTransferBytes(bytes: number, elapsedMs: number, maximum: number) {
  const budget = bytes / Math.max(elapsedMs, 1) * 20_000;
  let result = INITIAL_TRANSFER_BYTES;
  for (const size of [8, 16, 32]) if (size * MIB <= budget) result = size * MIB;
  return Math.min(result, maximum);
}
