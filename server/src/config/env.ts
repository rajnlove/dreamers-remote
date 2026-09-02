export const env = {
  port: Number(process.env.APP_PORT ?? 8080),
  databaseFile: process.env.DATABASE_FILE ?? "./data/dreamers-remote.sqlite",
  sessionSecret: process.env.SESSION_SECRET ?? "dev-insecure-secret-change-me",
  adminUsername: process.env.ADMIN_USERNAME ?? "admin",
  adminPassword: process.env.ADMIN_PASSWORD,
  // P4-5: a second, non-admin account for the PHP Projects site to log
  // in as and reuse the session cookie when calling POST /api/jobs --
  // see auth/users.ts's seedServiceUser. Unset password (default) means
  // the feature is off; no service account is created and PHP
  // integration isn't live yet.
  phpServiceUsername: process.env.PHP_SERVICE_USERNAME ?? "php-service",
  phpServicePassword: process.env.PHP_SERVICE_PASSWORD,
  // Phase 4 (P4-2): UNC roots an ffmpeg job's sourcePath/outputPath must
  // fall under -- comma-separated, e.g.
  // "\\192.29.11.92\Projects,\\192.29.11.92\Renders". Empty by default
  // (deny-all) so a fresh deployment doesn't silently accept arbitrary
  // paths until an admin actually configures this. The Agent has its
  // own independent copy of this same check (AllowedPathsConfigStore)
  // -- defense in depth, not just server-side.
  ffmpegAllowedRoots: (process.env.FFMPEG_ALLOWED_ROOTS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0),
};
