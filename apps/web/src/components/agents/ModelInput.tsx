"use client";

import { useEffect, useState } from "react";
import { fetchModels } from "@/lib/api";
import { useStore } from "@/lib/store";
import { AGENT_MODEL_OPTIONS, modelProvider } from "@/lib/agent-constants";

/** Models come from the provider (Anthropic's models API, OpenRouter's
 * catalog, the Codex CLI's own list); AGENT_MODEL_OPTIONS is only the
 * fallback when there's no Anthropic key to ask with. An empty value picks
 * the newest Sonnet for Claude runtimes, and means "Codex's own default" for Codex. */
export function ModelInput({
  runtimeId,
  value,
  onChange,
  label = "Model",
}: {
  runtimeId: string;
  value: string;
  onChange: (model: string) => void;
  label?: string;
}) {
  const provider = modelProvider(runtimeId);
  // Tagged with its provider: right after a runtime switch the previous
  // provider's list is still in state, and must not be auto-picked from.
  const [loaded, setLoaded] = useState<{ provider: string; models: string[] }>({ provider, models: [] });
  const models = loaded.provider === provider ? loaded.models : [];
  // refetch once an Anthropic key is saved (or replaced/removed) while open
  const anthropicKey = useStore((s) => s.anthropicKey);

  useEffect(() => {
    let live = true;
    fetchModels(provider)
      .catch(() => [])
      .then((m) => live && setLoaded({ provider, models: m.length || provider !== "anthropic" ? m : [...AGENT_MODEL_OPTIONS] }));
    return () => {
      live = false;
    };
  }, [provider, anthropicKey]);

  useEffect(() => {
    const list = loaded.provider === provider ? loaded.models : [];
    if (!value && provider === "anthropic" && list.length) onChange(list.find((m) => /sonnet/i.test(m)) ?? list[0]);
  }, [value, provider, loaded, onChange]);

  if (provider === "openrouter") {
    return (
      <div>
        <label className="mb-1.5 block text-xs font-medium text-foreground-muted">{label}</label>
        <input
          aria-label={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          list="openrouter-models"
          placeholder="e.g. openai/gpt-4o, anthropic/claude-sonnet-5.5"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <datalist id="openrouter-models">
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <p className="mt-1.5 text-xs text-foreground-muted">
          Start typing to search the {models.length || ""} models OpenRouter hosts.
        </p>
      </div>
    );
  }

  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-foreground-muted">{label}</label>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
      >
        {provider === "codex" && <option value="">Codex default (from your Codex config)</option>}
        {/* keep an agent's current model selectable even if the provider retired it */}
        {[...(value && !models.includes(value) ? [value] : []), ...models].map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </div>
  );
}
