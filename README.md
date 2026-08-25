# Hivemark

A team chat app (like Slack/Buzz), but with no flat channel list — instead: **Team/Project Rooms**, each containing one or more **Task Rooms** (a scoped space for one piece of work, not a permanent channel).

Ships as both a web app and an Electron desktop app, sharing the same frontend.

## Features

- **Rooms → Task Rooms** — a Room is a team/project (e.g. "Platform Team"); each Room holds several Task Rooms (e.g. "Rework onboarding flow"), which is where the actual chat, agents, and work items live.
- **Agents** — created inside a Task Room, backed by a real Claude model, with an instructions prompt and a set of granted MCP tools. Reply when `@mentioned` in the Task Room chat, or 1:1 in a **Direct Message**.
- **Agent Teams** — group agents into a reusable team and clone the whole group into a new Task Room in one action.
- **Agent Runtimes** (Settings → Agent runtimes) — which execution backend an agent uses. All five are real, not cosmetic — see "Agent Runtimes" below. Plus global agent defaults and behavior toggles.
- **Connections** (Settings → Connections) — where you paste your own Anthropic and/or OpenRouter API key, and per-tool credentials (GitHub/Postgres/Slack/Linear); stored locally, never read from an environment variable.
- **Workflows, Loops, Todos** — per-Task-Room. Workflows are a checklist with a draft/running/done status; Loops fire a recurring agent run on a schedule; Todos are a plain assignable list.

## Architecture

A single npm-workspaces monorepo with three packages:

| Package | What it is | Stack |
|---|---|---|
| `apps/web` | The UI | Next.js (static export) + Zustand |
| `apps/server` | The backend | Express + SQLite (`better-sqlite3`) + WebSocket, real Claude API calls, real MCP tool client |
| `apps/desktop` | The desktop shell | Electron; loads `apps/web` and spawns `apps/server` as a child process |

`apps/web` never mocks anything — it's a thin client that calls `apps/server`'s REST API and refetches state on a WebSocket `sync` push. All persistence, Claude calls, and MCP tool execution happen in `apps/server`, backed by a local SQLite file (`apps/server/data/`).

## Prerequisites

- Node.js `>=22.9.0` (the repo currently runs on 22.6.0 with an engine warning you can ignore, but newer is recommended)
- npm (workspaces-aware; this repo uses npm, not yarn/pnpm)

## Setup

```bash
git clone <this-repo>
cd hivemark
npm install
```

That single `npm install` at the root installs all three workspace packages.

## Running in development

**In the browser** (one command, one terminal):
```bash
npm run dev   # starts apps/server on :4001 and apps/web on :3000 together
```
Then open http://localhost:3000. Ctrl+C stops both.

**In the Electron app** (two terminals — Electron auto-spawns the backend itself, so don't also run `npm run dev`):
```bash
npm run dev:web           # http://localhost:3000
npm run dev --workspace=desktop  # spawns apps/server itself, then opens a window
```

Either way, on first load the app seeds itself with demo data (rooms, agents, a workflow, a loop, todos) into `apps/server/data/hivemark.db`.

## Connecting a real Claude API key

Agents don't work until you add credentials — **the app never reads an API key from an environment variable**, by design (it's a local-first app; you paste your own key into the UI and it's stored in the local SQLite file, not sent anywhere else).

1. Open the app → gear icon (top left) → **Agent settings** → **Connections**.
2. Paste an Anthropic API key (from console.anthropic.com) → **Save**.
3. `@mention` an agent in a Task Room, or open a DM with one, to get a real Claude reply.

The same Connections panel accepts a GitHub token, a Postgres connection string, a Slack bot token, and a Linear API key — add them once you grant the corresponding tool to an agent.

## Agent Runtimes

Set an agent's Runtime per-agent, or as the global default in Settings → Agent runtimes. All five actually run the agent, not just label it:

| Runtime | How it runs | Auth | Verified |
|---|---|---|---|
| **Hivemark Agent** | Calls the Anthropic API directly (`@anthropic-ai/sdk`) | Hivemark's stored Anthropic key | Live, incl. tool calls |
| **OpenRouter** | Calls OpenRouter's chat-completions API directly (plain `fetch`, `apps/server/src/openrouterAgent.ts`) | Hivemark's stored OpenRouter key | Live, incl. tool calls |
| **Claude Code** | Spawns the real `claude -p` CLI (`apps/server/src/claudeCodeAgent.ts`) | Whatever's already logged in for the `claude` CLI on this machine | Live |
| **Codex** | Spawns `npx @agentclientprotocol/codex-acp` and talks to it over the real Agent Client Protocol (`apps/server/src/codexAgent.ts`, using `@agentclientprotocol/sdk`) | Whatever's already configured for the Codex CLI (OPENAI_API_KEY/CODEX_API_KEY env var, or ChatGPT login) | Protocol verified live (handshake/session/prompt all real); no reply seen since no Codex credentials were available to test with |
| **Goose** | Spawns the real `goose run --no-session` CLI (`apps/server/src/gooseAgent.ts`) | Hivemark's stored Anthropic key, passed as `ANTHROPIC_API_KEY` | Live |

For OpenRouter, an agent's Model field switches from the fixed Claude picker to free text — type any model slug OpenRouter hosts, e.g. `openai/gpt-4o`, `anthropic/claude-3.7-sonnet`, `meta-llama/llama-3.1-70b-instruct`.

The Claude Code runtime card in Settings → Agent runtimes shows whether the `claude` CLI is signed in on this machine, with a **Sign in with Claude** button when it isn't. Clicking it runs the real `claude auth login` (opens the user's actual browser to Anthropic's OAuth consent page); the UI polls status every 2s until it detects a successful login. This is a real, supported flow (`claude auth login`/`claude auth status --json`, `apps/server/src/claudeCodeAuth.ts`) — not something reverse-engineered, since Anthropic doesn't offer a public "Sign in with Claude" OAuth flow for third-party apps generally.

Claude Code and Codex are text-only for now — granting an MCP tool to an agent on one of those runtimes has no effect. Claude Code's own huge built-in toolset (Bash, Read, Write, Edit, ...) isn't exposed at all; Codex's tool-call permission requests are auto-denied (it can still reason and reply, just can't take actions on this machine) since there's no one to approve them in a headless server process. Wiring either up properly is a deliberate, separate, security-reviewed feature — not something to enable by accident.

## MCP tools

Agents can be granted tools from the MCP catalog:

- **Browser** — spawns the real `@playwright/mcp` server, no credentials needed (but you need `npx playwright install chromium` once for it to actually control a browser).
- **GitHub**, **Postgres** — spawn the real official MCP servers over stdio, gated on the matching Connections credential.
- **Slack**, **Linear** — implemented as direct REST/GraphQL calls (not real spawned MCP servers) using the matching Connections credential.

## Loops

A Loop fires recurring agent runs in its Task Room. The scheduler only understands two schedule formats: `"Every day at HH:MM"` and `"Every N minutes/hours/days"` — anything else typed into the schedule field just never fires (see the `ponytail:` comment in `apps/server/src/scheduler.ts` for the upgrade path if you need real cron expressions).

## Building for production

```bash
npm run build:web                              # static-exports apps/web to apps/web/out
npm run build:desktop --workspace=desktop       # builds apps/server + packages the Electron app
```

`build:desktop` also runs `electron-rebuild` to recompile `better-sqlite3`'s native binding against Electron's own Node ABI, and bundles `apps/server`'s compiled `dist/` + `node_modules` into the packaged app so it doesn't depend on the end user having Node installed.

### A gotcha if you touch `apps/desktop/package.json`

`apps/desktop/node_modules` is a **symlink** to the root `node_modules` (`ln -s ../../node_modules apps/desktop/node_modules`) — don't delete it. Without it, electron-builder's packager sees no local `node_modules` in `apps/desktop`, wrongly concludes dependencies aren't installed, and runs its own `npm install --production` scoped to that folder — which prunes `apps/desktop`'s own devDependencies (electron-builder itself included) out from under itself mid-build. If a full clean (`rm -rf node_modules && npm install`) ever removes the symlink, just recreate it before running `build:desktop`.

electron-builder is also pinned to `^25.x`, not `^26.x` — `app-builder-lib@26` added a `@noble/hashes@2.x` dependency that its own code tries to `require()` even though v2 dropped CommonJS support, which breaks packaging outright. 25.x doesn't have that dependency at all.

## Known limitations

- Loops only understand the two schedule formats above — no real cron parser.
- Slack/Linear tools are simplified direct API calls, not real MCP servers.
- No automated test suite — everything's been verified by hand (browser automation + curl) rather than a CI-run suite.
