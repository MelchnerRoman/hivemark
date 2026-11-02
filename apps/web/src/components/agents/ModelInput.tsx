"use client";

import { useEffect, useState } from "react";
import { fetchModels } from "@/lib/api";
import { AGENT_MODEL_OPTIONS } from "@/lib/agent-constants";

/** Models come from the provider (Anthropic's models API, OpenRouter's
 * catalog); AGENT_MODEL_OPTIONS is only the fallback when there's no API key
 * to ask with. An empty value picks the newest Sonnet. */
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
  const isOpenRouter = runtimeId === "runtime-openrouter";
  const [models, setModels] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    fetchModels(isOpenRouter ? "openrouter" : "anthropic")
      .catch(() => [])
      .then((m) => live && setModels(m.length || isOpenRouter ? m : [...AGENT_MODEL_OPTIONS]));
    return () => {
      live = false;
    };
  }, [isOpenRouter]);

  useEffect(() => {
    if (!value && !isOpenRouter && models.length) onChange(models.find((m) => /sonnet/i.test(m)) ?? models[0]);
  }, [value, isOpenRouter, models, onChange]);

  if (isOpenRouter) {
    return (
      <div>
        <label className="mb-1.5 block text-xs font-medium text-foreground-muted">{label}</label>
        <input
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
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
      >
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
