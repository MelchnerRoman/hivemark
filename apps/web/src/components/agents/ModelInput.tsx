"use client";

import { AGENT_MODEL_OPTIONS } from "@/lib/agent-constants";

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
  if (runtimeId === "runtime-openrouter") {
    return (
      <div>
        <label className="mb-1.5 block text-xs font-medium text-foreground-muted">{label}</label>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. openai/gpt-4o, anthropic/claude-3.7-sonnet"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <p className="mt-1.5 text-xs text-foreground-muted">
          Any model slug OpenRouter hosts — see openrouter.ai/models.
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
        {AGENT_MODEL_OPTIONS.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </div>
  );
}
