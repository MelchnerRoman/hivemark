"use client";

import { useStore } from "@/lib/store";

export function RuntimeSelect({
  value,
  onChange,
  label = "Runtime",
}: {
  value: string;
  onChange: (runtimeId: string) => void;
  label?: string;
}) {
  const runtimes = useStore((s) => s.agentRuntimes);
  const selected = runtimes.find((r) => r.id === value);

  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-foreground-muted">{label}</label>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
      >
        {runtimes.map((r) => (
          <option key={r.id} value={r.id}>
            {r.icon} {r.name}
            {r.status === "cli_needed" ? " (CLI needed)" : ""}
          </option>
        ))}
      </select>
      {selected?.status === "cli_needed" && (
        <p className="mt-1.5 text-xs text-warning">
          {selected.name} needs its CLI installed on this machine before agents using it can actually run.
        </p>
      )}
    </div>
  );
}
