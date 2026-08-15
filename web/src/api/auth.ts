import { API_BASE_URL } from "./config";

export interface CurrentUser {
  username: string;
}

async function extractError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

export async function getCurrentUser(): Promise<CurrentUser> {
  const res = await fetch(`${API_BASE_URL}/api/auth/me`, { credentials: "include" });
  if (!res.ok) {
    throw new Error(await extractError(res, "Not authenticated"));
  }
  return res.json() as Promise<CurrentUser>;
}

export async function login(username: string, password: string): Promise<CurrentUser> {
  const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    throw new Error(await extractError(res, "Login failed"));
  }
  return res.json() as Promise<CurrentUser>;
}

export async function logout(): Promise<void> {
  await fetch(`${API_BASE_URL}/api/auth/logout`, { method: "POST", credentials: "include" });
}
