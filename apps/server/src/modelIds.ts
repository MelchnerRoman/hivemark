import Anthropic from "@anthropic-ai/sdk";
import { repo } from "./db.js";

/** Agents store the model's display name ("Claude Sonnet 5.5"), as listed by
 * the provider (listModels below). Turns need the API id ("claude-sonnet-5-5"). */
let anthropicModels: { id: string; name: string }[] = [];
let fetchedAt = 0;

/** Display names from Anthropic's models API, newest first. Empty when no
 * API key is stored (e.g. Claude Code on a subscription) — the UI then shows
 * its built-in list. Cached for 10 minutes. */
export async function listAnthropicModels(): Promise<string[]> {
  const apiKey = repo.getConnectionValue("anthropic");
  if (!apiKey) return [];
  if (Date.now() - fetchedAt > 10 * 60_000) {
    const models: { id: string; name: string }[] = [];
    for await (const m of new Anthropic({ apiKey }).models.list({ limit: 100 })) models.push({ id: m.id, name: m.display_name });
    anthropicModels = models;
    fetchedAt = Date.now();
  }
  return anthropicModels.map((m) => m.name);
}

/** Every model slug OpenRouter hosts (public endpoint, no key needed). */
let openRouterModels: string[] = [];
export async function listOpenRouterModels(): Promise<string[]> {
  if (!openRouterModels.length) {
    const res = await fetch("https://openrouter.ai/api/v1/models");
    if (!res.ok) throw new Error(`OpenRouter models: ${res.status}`);
    openRouterModels = ((await res.json()) as { data: { id: string }[] }).data.map((m) => m.id).sort();
  }
  return openRouterModels;
}

/** Fetched list first; otherwise Anthropic's naming convention
 * ("Claude Sonnet 5.5" -> "claude-sonnet-5-5"), which also passes raw ids
 * through unchanged. No model set -> the newest Sonnet. */
export function resolveModelId(displayName: string): string {
  if (!displayName) return anthropicModels.find((m) => m.id.includes("sonnet"))?.id ?? "claude-sonnet-5-5";
  return (
    anthropicModels.find((m) => m.name === displayName)?.id ??
    displayName.trim().toLowerCase().replace(/[\s.]+/g, "-")
  );
}

// Warm the cache at boot so names the static fallback can't derive still resolve.
listAnthropicModels().catch(() => {});
