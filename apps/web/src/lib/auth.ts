// Session token storage. Guarded the same way page.tsx already guards
// Notification access — localStorage must never be touched at module top
// level, or the static-export prerender build breaks.
const TOKEN_KEY = "hivemark_session_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_KEY);
}
