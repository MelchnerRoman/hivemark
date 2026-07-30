const OPENERS = ["On it.", "Got it.", "Sure thing.", "Noted.", "Looking into that now."];

function truncate(text: string, max = 80) {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max).trim()}…` : trimmed;
}

/**
 * Placeholder agent response — there's no real model call wired up yet, this
 * just gives @mentions and DMs something plausible to answer with so the
 * chat flow reads naturally in the meantime.
 */
export function mockAgentReply(userText: string): string {
  const opener = OPENERS[Math.floor(Math.random() * OPENERS.length)];
  return `${opener} I'll look into "${truncate(userText)}" and follow up here.`;
}
