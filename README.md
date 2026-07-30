# Hivemark

A team chat app (like Slack/Buzz), but with no flat channel list — instead: **Team/Project Rooms**, each containing one or more **Task Rooms** (a scoped space for one piece of work, not a permanent channel).

Ships as both a web app and an Electron desktop app, sharing the same frontend.

## Features

- **Rooms → Task Rooms** — a Room is a team/project (e.g. "Platform Team"); each Room holds several Task Rooms (e.g. "Rework onboarding flow"), which is where the actual chat, agents, and work items live.
- **Agents** — created inside a Task Room, backed by a real Claude model, with an instructions prompt and a set of granted MCP tools. Reply when `@mentioned` in the Task Room chat, or 1:1 in a **Direct Message**.
- **Agent Teams** — group agents into a reusable team and clone the whole group into a new Task Room in one action.
- **Agent Runtimes** (Settings → Agent runtimes) — which execution backend an agent uses (native Hivemark agent, Claude Code, Codex, Goose), plus global agent defaults and behavior toggles.
- **Connections** (Settings → Connections) — where you paste your own Anthropic API key and per-tool credentials (GitHub/Postgres/Slack/Linear); stored locally, never read from an environment variable.
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

You need the backend and the web frontend running. Pick one of:

**A. In the browser** (two terminals):
```bash
npm run dev --workspace=server   # http://localhost:4001
npm run dev --workspace=web      # http://localhost:3000
```

**B. In the Electron app** (two terminals — Electron auto-spawns the backend for you):
```bash
npm run dev --workspace=web      # http://localhost:3000
npm run dev --workspace=desktop  # spawns apps/server itself, then opens a window
```

Either way, on first load the app seeds itself with demo data (rooms, agents, a workflow, a loop, todos) into `apps/server/data/hivemark.db`.

## Connecting a real Claude API key

Agents don't work until you add credentials — **the app never reads an API key from an environment variable**, by design (it's a local-first app; you paste your own key into the UI and it's stored in the local SQLite file, not sent anywhere else).

1. Open the app → gear icon (top left) → **Agent settings** → **Connections**.
2. Paste an Anthropic API key (from console.anthropic.com) → **Save**.
3. `@mention` an agent in a Task Room, or open a DM with one, to get a real Claude reply.

The same Connections panel accepts a GitHub token, a Postgres connection string, a Slack bot token, and a Linear API key — add them once you grant the corresponding tool to an agent.

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
