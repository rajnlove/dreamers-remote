export const env = {
  port: Number(process.env.APP_PORT ?? 8080),
  databaseFile: process.env.DATABASE_FILE ?? "./data/dreamers-remote.sqlite",
};
