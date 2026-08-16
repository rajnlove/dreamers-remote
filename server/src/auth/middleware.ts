import type { NextFunction, Request, Response } from "express";
import { getUserById } from "./users.js";

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  next();
}

// Only meaningfully differs from requireAuth once M7 (roles) exists — V1
// has exactly one account and it's always admin. Kept separate so
// destructive routes (restart/shutdown) are already gated correctly rather
// than needing every call site retrofitted later.
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const user = getUserById(req.session.userId);
  if (!user?.is_admin) {
    res.status(403).json({ error: "Admin required" });
    return;
  }
  next();
}
