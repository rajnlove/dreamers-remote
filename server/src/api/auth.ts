import { Router } from "express";
import { getUserById, getUserByUsername } from "../auth/users.js";
import { verifyPassword } from "../auth/password.js";

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
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  req.session.userId = user.id;
  res.json({ username: user.username });
});

authRouter.post("/logout", (req, res) => {
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
