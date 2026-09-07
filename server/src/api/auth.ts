import { Router } from "express";
import { getUserById, getUserByUsername } from "../auth/users.js";
import { verifyPassword } from "../auth/password.js";
import { recordAudit } from "../audit/repository.js";

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const { username, password } = body;
  if (typeof username !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "username and password are required" });
    return;
  }

  const user = getUserByUsername(username);
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    // The attempted username is recorded (so repeated attempts against one
    // account are visible) but never the submitted password — M8 rule.
    // Whether the account exists is deliberately not distinguished here,
    // matching the response the caller gets.
    recordAudit({ action: "login.failure", req, actorUsername: username.slice(0, 64) });
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  req.session.userId = user.id;
  recordAudit({ action: "login.success", req, targetType: "user", targetId: user.id, targetLabel: user.username });
  res.json({ username: user.username });
});

authRouter.post("/logout", (req, res) => {
  // Recorded before destroy(), while the session still identifies the actor.
  recordAudit({ action: "logout", req });
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

authRouter.get("/me", (req, res) => {
  const user = req.session.userId ? getUserById(req.session.userId) : undefined;
  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  res.json({ username: user.username });
});
