export const env = {
  port: Number(process.env.APP_PORT ?? 8080),
  databaseFile: process.env.DATABASE_FILE ?? "./data/dreamers-remote.sqlite",
  sessionSecret: process.env.SESSION_SECRET ?? "dev-insecure-secret-change-me",
  adminUsername: process.env.ADMIN_USERNAME ?? "admin",
  adminPassword: process.env.ADMIN_PASSWORD,
};
