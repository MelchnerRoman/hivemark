"use client";

import { FormEvent, useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Switch } from "@/components/ui/Switch";
import { useStore } from "@/lib/store";
import { AGENT_MODEL_OPTIONS } from "@/lib/agent-constants";
import { fetchConnections, removeConnection, setConnection } from "@/lib/api";
import type { AgentDefaults, ConnectionStatus } from "@/lib/types";

export function AgentSettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Agent settings" size="lg">
      {/* Keyed on `open` so the defaults form remounts with the latest saved
          values as its initial state each time it opens, instead of syncing via effect. */}
      {open && <AgentSettingsBody key={String(open)} />}
    </Modal>
  );
}

function AgentSettingsBody() {
  const behavior = useStore((s) => s.agentBehaviorSettings);
  const setAgentBehaviorSetting = useStore((s) => s.setAgentBehaviorSetting);
  const runtimes = useStore((s) => s.agentRuntimes);
  const installRuntime = useStore((s) => s.installRuntime);
  const agentDefaults = useStore((s) => s.agentDefaults);
  const setAgentDefaults = useStore((s) => s.setAgentDefaults);

  const [runtimeId, setRuntimeId] = useState(agentDefaults.runtimeId);
  const [model, setModel] = useState<AgentDefaults["model"]>(agentDefaults.model);
  const [instructions, setInstructions] = useState(agentDefaults.instructions);

  function handleSaveDefaults(e: FormEvent) {
    e.preventDefault();
    setAgentDefaults({ model, runtimeId, instructions: instructions.trim() });
  }

  return (
    <div className="space-y-8">
      <section>
        <h3 className="font-display text-base font-semibold">Agents</h3>
        <p className="mt-1 text-sm text-foreground-muted">
          Control how agents behave in conversations and run on this machine.
        </p>
        <div className="mt-4 space-y-3">
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">Keep addressed agents active</p>
              <p className="mt-0.5 text-xs text-foreground-muted">
                Keep agents you @mention selected for future messages in the same Task Room. Remove them from the
                composer at any time.
              </p>
            </div>
            <Switch
              checked={behavior.keepAddressedAgentsActive}
              onChange={(v) => setAgentBehaviorSetting("keepAddressedAgentsActive", v)}
              label="Keep addressed agents active"
            />
          </div>
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">Keep awake while agents are active</p>
              <p className="mt-0.5 text-xs text-foreground-muted">
                Prevents the desktop app from sleeping while agents are running. Releases automatically once every
                agent stops.
              </p>
            </div>
            <Switch
              checked={behavior.keepAwakeWhileAgentsActive}
              onChange={(v) => setAgentBehaviorSetting("keepAwakeWhileAgentsActive", v)}
              label="Keep awake while agents are active"
            />
          </div>
        </div>
      </section>

      <section>
        <h3 className="font-display text-base font-semibold">Agent runtimes</h3>
        <p className="mt-1 text-sm text-foreground-muted">Choose which agent tools Hivemark can use on this device.</p>
        <div className="mt-4 space-y-2">
          {runtimes.map((runtime) => (
            <div key={runtime.id} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="text-lg leading-none">{runtime.icon}</span>
                  <span className="text-sm font-medium">{runtime.name}</span>
                  {runtime.status === "cli_needed" && <Badge tone="warning">CLI needed</Badge>}
                  {runtime.status === "ready" && <Badge tone="accent">Ready</Badge>}
                </div>
                {runtime.status === "cli_needed" && (
                  <Button variant="secondary" onClick={() => installRuntime(runtime.id)}>
                    Install
                  </Button>
                )}
              </div>
              <p className="mt-1.5 text-xs text-foreground-muted">{runtime.description}</p>
              {runtime.installHint && (
                <code className="mt-1.5 block rounded bg-surface-raised px-2 py-1 text-xs text-foreground-muted">
                  {runtime.installHint}
                </code>
              )}
              {runtime.setupUrl && (
                <a
                  href={runtime.setupUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1.5 inline-block text-xs text-brand hover:underline"
                >
                  CLI setup guide ↗
                </a>
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          disabled
          title="Custom runtimes aren't supported yet"
          className="mt-3 flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-sm text-foreground-muted opacity-60"
        >
          <span>+</span> Add runtimes
        </button>
      </section>

      <section>
        <form onSubmit={handleSaveDefaults} className="space-y-4">
          <div>
            <h3 className="font-display text-base font-semibold">Agent defaults</h3>
            <p className="mt-1 text-sm text-foreground-muted">
              Runtime, model, and instructions inherited by new agents. Agent-specific settings always take priority.
            </p>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground-muted">Default runtime</label>
            <select
              value={runtimeId}
              onChange={(e) => setRuntimeId(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
            >
              {runtimes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.icon} {r.name}
                  {r.status === "cli_needed" ? " (CLI needed)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground-muted">Default model</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
            >
              {AGENT_MODEL_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-foreground-muted">Saved changes take effect on new agents.</p>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground-muted">
              Default instructions template
            </label>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="e.g. Always summarize findings back to the task room chat before finishing."
              rows={3}
              className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
            />
          </div>
          <div className="flex justify-end pt-1">
            <Button type="submit">Save defaults</Button>
          </div>
        </form>
      </section>

      <ConnectionsSection />
    </div>
  );
}

const CONNECTION_HELP: Record<string, string> = {
  anthropic: "Required for agents to reply at all. Get a key at console.anthropic.com.",
  github: "Lets agents use the GitHub tool (issues, PRs, repo search).",
  postgres: "Connection string for the Postgres tool, e.g. postgres://user:pass@host:5432/db.",
  slack: "Bot token for the Slack tool, e.g. xoxb-...",
  linear: "Personal API key for the Linear tool.",
};

function ConnectionsSection() {
  const [connections, setConnections] = useState<ConnectionStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    fetchConnections()
      .then(setConnections)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  async function refresh() {
    try {
      setConnections(await fetchConnections());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSave(key: string) {
    const value = (drafts[key] ?? "").trim();
    if (!value) return;
    setSavingKey(key);
    try {
      await setConnection(key as ConnectionStatus["key"], value);
      setDrafts((d) => ({ ...d, [key]: "" }));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingKey(null);
    }
  }

  async function handleRemove(key: string) {
    setSavingKey(key);
    try {
      await removeConnection(key as ConnectionStatus["key"]);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <section>
      <h3 className="font-display text-base font-semibold">Connections</h3>
      <p className="mt-1 text-sm text-foreground-muted">
        API keys and tokens are stored locally on this machine and used only to let your agents call these
        services directly.
      </p>

      {error && (
        <p className="mt-3 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
          {error}
          {error.includes("fetch") && " — is the Hivemark backend running on localhost:4001?"}
        </p>
      )}

      <div className="mt-4 space-y-3">
        {connections === null && !error && <p className="text-sm text-foreground-muted">Loading…</p>}
        {connections?.map((conn) => (
          <div key={conn.key} className="rounded-lg border border-border p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="text-sm font-medium">{conn.label}</span>
                {conn.connected ? (
                  <Badge tone="accent">Connected · ···{conn.hint}</Badge>
                ) : (
                  <Badge tone="neutral">Not connected</Badge>
                )}
              </div>
              {conn.connected && (
                <Button
                  variant="danger"
                  disabled={savingKey === conn.key}
                  onClick={() => handleRemove(conn.key)}
                >
                  Remove
                </Button>
              )}
            </div>
            <p className="mt-1.5 text-xs text-foreground-muted">{CONNECTION_HELP[conn.key]}</p>
            <div className="mt-2 flex gap-2">
              <input
                type="password"
                value={drafts[conn.key] ?? ""}
                onChange={(e) => setDrafts((d) => ({ ...d, [conn.key]: e.target.value }))}
                placeholder={conn.connected ? "Enter a new value to replace it" : "Paste key or token"}
                className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-brand"
              />
              <Button
                variant="secondary"
                disabled={savingKey === conn.key || !(drafts[conn.key] ?? "").trim()}
                onClick={() => handleSave(conn.key)}
              >
                Save
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
