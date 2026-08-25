// Read once at boot. Auth stays fully disabled (today's single-hardcoded-user
// behavior, zero UI change) unless at least one OAuth provider is configured —
// a self-hoster opts in by setting that provider's client id/secret env vars.
// Split into its own module (no imports) so both db.ts and auth.ts can read
// it without creating a circular import between them.

export type OAuthProviderConfig = {
  clientId: string;
  clientSecret: string;
  authUrl: string;
  tokenUrl: string;
  scope: string;
};

function providerConfig(name: string, authUrl: string, tokenUrl: string, scope: string): OAuthProviderConfig | null {
  const clientId = process.env[`${name}_CLIENT_ID`];
  const clientSecret = process.env[`${name}_CLIENT_SECRET`];
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, authUrl, tokenUrl, scope };
}

export const OAUTH_PROVIDERS: Record<"google" | "github", OAuthProviderConfig | null> = {
  google: providerConfig(
    "GOOGLE",
    "https://accounts.google.com/o/oauth2/v2/auth",
    "https://oauth2.googleapis.com/token",
    "openid email profile"
  ),
  github: providerConfig("GITHUB", "https://github.com/login/oauth/authorize", "https://github.com/login/oauth/access_token", "read:user user:email"),
};

export const AUTH_ENABLED = Object.values(OAUTH_PROVIDERS).some((p) => p !== null);

export const PUBLIC_URL = process.env.PUBLIC_URL ?? null;
export const FRONTEND_URL = process.env.FRONTEND_URL ?? null;

export const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
export const ALLOWED_EMAIL_DOMAINS = (process.env.ALLOWED_EMAIL_DOMAINS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

if (AUTH_ENABLED && (!PUBLIC_URL || !FRONTEND_URL)) {
  throw new Error(
    "GOOGLE_CLIENT_ID/GITHUB_CLIENT_ID is set but PUBLIC_URL and/or FRONTEND_URL is missing — both are required once any OAuth provider is configured (PUBLIC_URL builds the OAuth redirect_uri, FRONTEND_URL is where the browser is sent back to after login)."
  );
}

export function isEmailAllowed(email: string): boolean {
  if (ALLOWED_EMAILS.length === 0 && ALLOWED_EMAIL_DOMAINS.length === 0) return true; // fully open, as requested
  const lower = email.toLowerCase();
  if (ALLOWED_EMAILS.includes(lower)) return true;
  const domain = lower.split("@")[1];
  return domain ? ALLOWED_EMAIL_DOMAINS.includes(domain) : false;
}
