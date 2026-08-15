import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// Registration tokens and agent credentials are both high-entropy random
// secrets (not user-chosen passwords), so a fast SHA-256 hash for storage
// is appropriate here — unlike server/src/auth/password.ts's scrypt,
// which exists specifically to slow down brute-forcing a low-entropy
// human password. Never store either secret in plaintext, per
// docs/SECURITY.md.

export function generateSecret(): string {
  return randomBytes(32).toString("hex");
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function secretMatchesHash(secret: string, hash: string): boolean {
  const a = Buffer.from(hashSecret(secret), "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
