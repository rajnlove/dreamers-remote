import { Router } from "express";
import { AUDIT_ACTIONS, isAuditAction } from "../audit/actions.js";
import { listAudit } from "../audit/repository.js";
import { requireAdmin } from "../auth/middleware.js";
import { ValidationError } from "../workstation/errors.js";

export const auditRouter = Router();

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function parseCount(raw: unknown, field: string, fallback: number, max: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new ValidationError(`${field} must be an integer between 0 and ${max}`);
  }
  return value;
}

// Read-only by design: there is no endpoint to edit or delete entries, and
// none should be added — an audit log a user can rewrite is not one. Admin-
// only because the log names who remoted into which machine and when, which
// is exactly the history an ordinary user should not be able to browse.
auditRouter.get("/", requireAdmin, (req, res, next) => {
  try {
    const limit = parseCount(req.query.limit, "limit", DEFAULT_LIMIT, MAX_LIMIT);
    const offset = parseCount(req.query.offset, "offset", 0, Number.MAX_SAFE_INTEGER);

    const rawAction = req.query.action;
    if (rawAction !== undefined && !isAuditAction(rawAction)) {
      throw new ValidationError(`action must be one of: ${AUDIT_ACTIONS.join(", ")}`);
    }

    const rawTarget = req.query.targetId;
    let targetId: number | undefined;
    if (rawTarget !== undefined) {
      targetId = Number(rawTarget);
      if (!Number.isInteger(targetId) || targetId <= 0) {
        throw new ValidationError("targetId must be a positive integer");
      }
    }

    res.json(listAudit({ limit: limit || DEFAULT_LIMIT, offset, action: rawAction, targetId }));
  } catch (err) {
    next(err);
  }
});

// The UI builds its filter dropdown from this rather than hardcoding a copy
// of the enum that silently drifts when a new action is added server-side.
auditRouter.get("/actions", requireAdmin, (_req, res) => {
  res.json(AUDIT_ACTIONS);
});
