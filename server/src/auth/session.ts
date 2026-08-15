import session from "express-session";
import { env } from "../config/env.js";

declare module "express-session" {
  interface SessionData {
    userId?: number;
  }
}

export const sessionMiddleware = session({
  secret: env.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    // Dashboard (port 8000) and API (port 8080) are different origins on
    // the same LAN host — "lax" still allows the cookie for our fetch/WS
    // calls since SameSite is scoped by host, not port. "secure" must
    // stay false: this app runs over plain HTTP (see docs/SECURITY.md),
    // and a "secure" cookie is silently dropped by browsers over HTTP.
    sameSite: "lax",
    secure: false,
  },
});
