// LAN-only V1: the dashboard talks to the backend's known address directly
// (no reverse proxy set up between the web and server containers).
// Override at build time with VITE_API_BASE_URL for other deployments.
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://192.29.11.92:8080";

export const WS_BASE_URL = API_BASE_URL.replace(/^http/, "ws");
