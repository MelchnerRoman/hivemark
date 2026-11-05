"use client";

import { FormEvent, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { createMcpServer, updateMcpServer, type CustomMcpInput } from "@/lib/api";
import { useStore } from "@/lib/store";
import type { McpTool } from "@/lib/types";

const PREFIX = "mcp-custom-";
const SLUG = /^[a-z0-9][a-z0-9-]{0,23}$/; // same rule as the server
const toSlug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 24)
    .replace(/-+$/, "");
const INPUT = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand";
const LABEL = "mb-1.5 block text-xs font-medium text-foreground-muted";

/** `tool` set = edit that custom server, null = add a new one. */
export function CustomMcpModal({ open, tool, onClose }: { open: boolean; tool: McpTool | null; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title={tool ? `Edit ${tool.name}` : "Add MCP server"} size="lg">
      {open && <CustomMcpForm key={tool?.id ?? "new"} tool={tool} onClose={onClose} />}
    </Modal>
  );
}

function CustomMcpForm({ tool, onClose }: { tool: McpTool | null; onClose: () => void }) {
  const c = tool?.custom;
  const [name, setName] = useState(tool?.name ?? "");
  const [slug, setSlug] = useState(tool ? tool.id.slice(PREFIX.length) : "");
  const [slugEdited, setSlugEdited] = useState(false);
  const [description, setDescription] = useState(tool?.description ?? "");
  const [kind, setKind] = useState<"stdio" | "http">(c?.kind ?? "stdio");
  const [command, setCommand] = useState(c?.command ?? "");
  const [args, setArgs] = useState((c?.args ?? []).join("\n"));
  const [url, setUrl] = useState(c?.url ?? "");
  // Stored values never come back: existing names are prefilled with blank values.
  const [secrets, setSecrets] = useState((c?.secretNames ?? []).map((n) => ({ name: n, value: "" })));
  const [secretsEdited, setSecretsEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const slugValid = SLUG.test(slug);
  const secretLabel = kind === "stdio" ? "Environment variables" : "Headers";
  const editSecrets = (next: { name: string; value: string }[]) => {
    setSecrets(next);
    setSecretsEdited(true);
  };

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const base = { name: name.trim(), description: description.trim() };
    const input: CustomMcpInput =
      kind === "stdio"
        ? { ...base, kind, command: command.trim(), args: args.split("\n").map((a) => a.trim()).filter(Boolean) }
        : { ...base, kind, url: url.trim() };
    // Untouched on edit (and same kind) = omit, so the server keeps the stored values.
    if (!tool || secretsEdited || kind !== c?.kind) {
      const rows = secrets.filter((s) => s.name.trim() || s.value);
      const blank = rows.find((s) => !s.value);
      if (blank) {
        setError(
          `Enter a value for "${blank.name.trim() || "(unnamed)"}". Stored values can't be shown, so once you change secrets, re-enter every value or remove the row.`
        );
        return;
      }
      input.secrets = Object.fromEntries(rows.map((s) => [s.name.trim(), s.value]));
    }
    setSaving(true);
    try {
      if (tool) await updateMcpServer(tool.id, input);
      else await createMcpServer({ ...input, slug });
      await useStore.getState().hydrate();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const canSubmit =
    !saving && name.trim() && slugValid && (kind === "stdio" ? command.trim() : url.trim());

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="mcp-name" className={LABEL}>
          Name
        </label>
        <input
          id="mcp-name"
          autoFocus
          value={name}
          maxLength={80}
          onChange={(e) => {
            setName(e.target.value);
            if (!tool && !slugEdited) setSlug(toSlug(e.target.value));
          }}
          placeholder="e.g. Company wiki"
          className={INPUT}
        />
      </div>
      <div>
        <label htmlFor="mcp-slug" className={LABEL}>
          ID
        </label>
        <input
          id="mcp-slug"
          value={slug}
          readOnly={!!tool}
          aria-invalid={!!slug && !slugValid}
          aria-describedby="mcp-slug-help"
          onChange={(e) => {
            setSlug(e.target.value);
            setSlugEdited(true);
          }}
          placeholder="company-wiki"
          className={`${INPUT} font-mono ${tool ? "opacity-60" : ""}`}
        />
        <p id="mcp-slug-help" className={`mt-1 text-xs ${slug && !slugValid ? "text-danger" : "text-foreground-muted"}`}>
          {tool
            ? "Can't be changed after creation."
            : "Lowercase letters, digits and dashes, up to 24 characters, starting with a letter or digit."}
        </p>
      </div>
      <div>
        <label htmlFor="mcp-description" className={LABEL}>
          Description
        </label>
        <textarea
          id="mcp-description"
          value={description}
          maxLength={500}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What it lets agents do. Shown when granting it."
          rows={2}
          className={`${INPUT} resize-none`}
        />
      </div>
      <fieldset>
        <legend className={LABEL}>Type</legend>
        <div className="flex gap-4 text-sm">
          {(
            [
              ["stdio", "Local command"],
              ["http", "Remote URL"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-1.5">
              <input type="radio" name="mcp-kind" value={value} checked={kind === value} onChange={() => setKind(value)} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      {kind === "stdio" ? (
        <>
          <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            This command runs on this computer with your user&apos;s permissions whenever an agent with access uses
            it. Only add servers you trust.
          </p>
          <div>
            <label htmlFor="mcp-command" className={LABEL}>
              Command
            </label>
            <input
              id="mcp-command"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="e.g. npx"
              className={`${INPUT} font-mono`}
            />
          </div>
          <div>
            <label htmlFor="mcp-args" className={LABEL}>
              Arguments (one per line)
            </label>
            <textarea
              id="mcp-args"
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              placeholder={"-y\n@modelcontextprotocol/server-everything"}
              rows={3}
              className={`${INPUT} resize-y font-mono`}
            />
          </div>
        </>
      ) : (
        <div>
          <label htmlFor="mcp-url" className={LABEL}>
            URL
          </label>
          <input
            id="mcp-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/mcp"
            className={`${INPUT} font-mono`}
          />
        </div>
      )}
      <fieldset>
        <legend className={LABEL}>{secretLabel}</legend>
        <p className="mb-2 text-xs text-foreground-muted">
          {kind === "stdio" ? "Passed to the command's environment" : "Sent with every request"}, stored encrypted on
          this machine.
          {tool && c?.secretNames?.length
            ? " Saved values are hidden: leave this list untouched to keep them."
            : ""}
        </p>
        <div className="space-y-2">
          {secrets.map((s, i) => (
            <div key={i} className="flex gap-2">
              <input
                aria-label={`${secretLabel} ${i + 1} name`}
                value={s.name}
                onChange={(e) => editSecrets(secrets.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                placeholder={kind === "stdio" ? "API_KEY" : "Authorization"}
                className={`${INPUT} font-mono`}
              />
              <input
                aria-label={`${secretLabel} ${i + 1} value`}
                type="password"
                autoComplete="off"
                value={s.value}
                onChange={(e) => editSecrets(secrets.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                placeholder={tool && !secretsEdited ? "Leave blank to keep" : "Value"}
                className={INPUT}
              />
              <Button
                type="button"
                variant="ghost"
                aria-label={`Remove ${s.name || `row ${i + 1}`}`}
                onClick={() => editSecrets(secrets.filter((_, j) => j !== i))}
              >
                ✕
              </Button>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="secondary"
          className="mt-2 text-xs"
          onClick={() => editSecrets([...secrets, { name: "", value: "" }])}
        >
          + Add {kind === "stdio" ? "variable" : "header"}
        </Button>
      </fieldset>
      {error && (
        <p role="alert" className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}
      <div className="sticky bottom-0 flex justify-end gap-2 bg-surface py-1">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canSubmit}>
          {saving ? "Saving…" : tool ? "Save" : "Add server"}
        </Button>
      </div>
    </form>
  );
}
