import type { NextFunction, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { repo, CURRENT_MEMBER_ID } from "./db.js";
import { AUTH_ENABLED, OAUTH_PROVIDERS, PUBLIC_URL, isEmailAllowed } from "./authConfig.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      memberId: string;
    }
  }
}

export type ProviderName = "google" | "github";

export function getEnabledProviders(): ProviderName[] {
  return (Object.keys(OAUTH_PROVIDERS) as ProviderName[]).filter((p) => OAUTH_PROVIDERS[p] !== null);
}

function redirectUri(provider: ProviderName): string {
  return `${PUBLIC_URL}/api/auth/${provider}/callback`;
}

// Short-lived, in-process only — fine for a single-instance server (this
// doesn't survive a restart or a multi-instance deploy, neither of which
// this architecture does). Pruned lazily on each access.
const pendingStates = new Map<string, number>(); // nonce -> createdAt
const STATE_TTL_MS = 10 * 60_000;
const loginCodes = new Map<string, { sessionToken: string; createdAt: number }>();
const LOGIN_CODE_TTL_MS = 60_000;

function prune<K, V extends { createdAt: number } | number>(map: Map<K, V>, ttlMs: number) {
  const now = Date.now();
  for (const [k, v] of map) {
    const createdAt = typeof v === "number" ? v : v.createdAt;
    if (now - createdAt > ttlMs) map.delete(k);
  }
}

export function buildAuthorizeUrl(provider: ProviderName): string {
  const config = OAUTH_PROVIDERS[provider];
  if (!config) throw new Error(`${provider} is not configured`);

  prune(pendingStates, STATE_TTL_MS);
  const state = randomBytes(16).toString("hex");
  pendingStates.set(state, Date.now());

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri(provider),
    scope: config.scope,
    state,
    response_type: "code",
  });
  if (provider === "google") params.set("access_type", "online");
  return `${config.authUrl}?${params.toString()}`;
}

export function verifyState(state: string | undefined): boolean {
  prune(pendingStates, STATE_TTL_MS);
  if (!state || !pendingStates.has(state)) return false;
  pendingStates.delete(state); // single-use
  return true;
}

type OAuthProfile = { providerUserId: string; name: string; email: string; avatarUrl: string | null };

async function exchangeGoogleCode(code: string): Promise<OAuthProfile> {
  const config = OAUTH_PROVIDERS.google!;
  const tokenRes = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: redirectUri("google"),
      grant_type: "authorization_code",
    }),
  });
  const tokenBody = (await tokenRes.json()) as any;
  if (!tokenRes.ok) throw new Error(`Google token exchange failed: ${tokenBody.error_description ?? tokenBody.error}`);

  const profileRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tokenBody.access_token}` },
  });
  const profile = (await profileRes.json()) as any;
  if (!profileRes.ok) throw new Error("Failed to fetch Google profile");

  return {
    providerUserId: profile.sub,
    name: profile.name ?? profile.email,
    email: profile.email,
    avatarUrl: profile.picture ?? null,
  };
}

async function exchangeGithubCode(code: string): Promise<OAuthProfile> {
  const config = OAUTH_PROVIDERS.github!;
  const tokenRes = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: redirectUri("github"),
    }),
  });
  const tokenBody = (await tokenRes.json()) as any;
  if (!tokenRes.ok || !tokenBody.access_token) {
    throw new Error(`GitHub token exchange failed: ${tokenBody.error_description ?? tokenBody.error ?? "no access_token"}`);
  }

  const authHeader = { Authorization: `Bearer ${tokenBody.access_token}`, "User-Agent": "hivemark" };
  const [profileRes, emailsRes] = await Promise.all([
    fetch("https://api.github.com/user", { headers: authHeader }),
    fetch("https://api.github.com/user/emails", { headers: authHeader }),
  ]);
  const profile = (await profileRes.json()) as any;
  if (!profileRes.ok) throw new Error("Failed to fetch GitHub profile");

  // GitHub's /user.email is frequently null (private-email setting) — the
  // verified primary address lives in /user/emails instead.
  let email: string | null = profile.email ?? null;
  if (!email && emailsRes.ok) {
    const emails = (await emailsRes.json()) as { email: string; primary: boolean; verified: boolean }[];
    email = emails.find((e) => e.primary && e.verified)?.email ?? emails.find((e) => e.verified)?.email ?? null;
  }
  if (!email) throw new Error("Your GitHub account has no verified email available — add one and try again.");

  return {
    providerUserId: String(profile.id),
    name: profile.name ?? profile.login,
    email,
    avatarUrl: profile.avatar_url ?? null,
  };
}

/** Exchanges an OAuth `code` for the caller's profile, finds-or-creates their
 * Member record, and issues a one-time login code for the frontend handoff
 * (never the real session token — that stays out of URLs/logs/history). */
export async function completeOAuthLogin(provider: ProviderName, code: string): Promise<string> {
  const profile = provider === "google" ? await exchangeGoogleCode(code) : await exchangeGithubCode(code);

  if (!isEmailAllowed(profile.email)) {
    throw new Error("This account isn't on the allowed list for this workspace.");
  }

  const member = repo.findOrCreateMemberByOAuth(provider, profile.providerUserId, {
    name: profile.name,
    email: profile.email,
    avatarUrl: profile.avatarUrl,
  });
  const sessionToken = repo.createSession(member.id);

  prune(loginCodes, LOGIN_CODE_TTL_MS);
  const loginCode = randomBytes(24).toString("hex");
  loginCodes.set(loginCode, { sessionToken, createdAt: Date.now() });
  return loginCode;
}

/** Single-use: trades the short-lived handoff code from the OAuth redirect
 * for the real bearer session token. */
export function exchangeLoginCode(code: string): string | null {
  prune(loginCodes, LOGIN_CODE_TTL_MS);
  const entry = loginCodes.get(code);
  if (!entry) return null;
  loginCodes.delete(code); // single-use
  return entry.sessionToken;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!AUTH_ENABLED) {
    req.memberId = CURRENT_MEMBER_ID;
    next();
    return;
  }
  const header = req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  if (!token) {
    res.status(401).json({ error: "Not signed in." });
    return;
  }
  const member = repo.getSessionMember(token);
  if (!member) {
    res.status(401).json({ error: "Session expired or invalid — sign in again." });
    return;
  }
  req.memberId = member.id;
  next();
}

export function requireAuthForWebSocket(url: string | undefined): boolean {
  if (!AUTH_ENABLED) return true;
  const token = url ? new URL(url, "http://localhost").searchParams.get("token") : null;
  return !!token && !!repo.getSessionMember(token);
}
