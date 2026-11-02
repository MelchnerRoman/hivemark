/** Maps the display names shown in the UI's Model picker to real Anthropic
 * model ID strings. Keep in sync with apps/web/src/lib/agent-constants.ts'
 * AGENT_MODEL_OPTIONS. */
const MODEL_ID_MAP: Record<string, string> = {
  "Claude Opus 5.5": "claude-opus-5-5",
  "Claude Sonnet 5.5": "claude-sonnet-5-5",
  "Claude Haiku 5.5": "claude-haiku-5-5",
  "Claude Opus 4.8": "claude-opus-4-8",
  "Claude Sonnet 5": "claude-sonnet-5",
  "Claude Haiku 4.5": "claude-haiku-4-5",
};

export function resolveModelId(displayName: string): string {
  return MODEL_ID_MAP[displayName] ?? "claude-sonnet-5";
}
