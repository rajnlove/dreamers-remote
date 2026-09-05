import { createHash } from "node:crypto";
import { db } from "../database/db.js";
import { createJob, getJob } from "./repository.js";
import type { JobInput } from "./types.js";
import { ConflictError, ValidationError } from "../workstation/errors.js";

db.exec(`CREATE TABLE IF NOT EXISTS job_requests (
  user_id INTEGER NOT NULL, request_key TEXT NOT NULL, digest TEXT NOT NULL,
  job_id INTEGER NOT NULL, PRIMARY KEY(user_id, request_key)
)`);

// A lost HTTP response must not enqueue the same uploaded video twice.
// Keep tombstones after history deletion; never replay a removed job as a new one.
export function createJobOnce(userId: number, key: string, input: JobInput) {
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(key)) throw new ValidationError("Invalid Idempotency-Key");
  const digest = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  return db.transaction(() => {
    const previous = db.prepare("SELECT * FROM job_requests WHERE user_id = ? AND request_key = ?")
      .get(userId, key) as { digest: string; job_id: number } | undefined;
    if (previous) {
      if (previous.digest !== digest) throw new ConflictError("Idempotency key already used for different input");
      const job = getJob(previous.job_id);
      if (!job) throw new ConflictError("Previously created job was removed; it will not be recreated");
      return job;
    }
    const job = createJob(input);
    db.prepare("INSERT INTO job_requests VALUES (?, ?, ?, ?)").run(userId, key, digest, job.id);
    return job;
  })();
}
