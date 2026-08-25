"use client";

import { useEffect, useState } from "react";
import { getAuthProviders, loginUrl } from "@/lib/api";
import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/Button";

const PROVIDER_LABELS: Record<string, string> = {
  google: "Continue with Google",
  github: "Continue with GitHub",
};

export function LoginScreen({ authError }: { authError?: string | null }) {
  const [providers, setProviders] = useState<string[] | null>(null);

  useEffect(() => {
    getAuthProviders()
      .then((r) => setProviders(r.providers))
      .catch(() => setProviders([]));
  }, []);

  return (
    <div className="flex h-screen w-full items-center justify-center bg-background px-4 text-foreground">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-xl">
        <div className="mb-6 flex justify-center">
          <Logo size={28} />
        </div>
        <p className="mb-6 text-center text-sm text-foreground-muted">Sign in to continue</p>

        {authError && (
          <p className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
            {authError}
          </p>
        )}

        <div className="space-y-2">
          {providers === null && <p className="text-center text-sm text-foreground-muted">Loading…</p>}
          {providers?.length === 0 && (
            <p className="text-center text-sm text-foreground-muted">
              No sign-in method is configured for this server yet.
            </p>
          )}
          {providers?.map((provider) => (
            <Button
              key={provider}
              variant="secondary"
              className="w-full justify-center"
              onClick={() => {
                window.location.href = loginUrl(provider);
              }}
            >
              {PROVIDER_LABELS[provider] ?? `Continue with ${provider}`}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
