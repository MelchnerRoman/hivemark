# Hivemark

A team chat app (like Slack/Buzz), but with no flat channel list — instead: **Team/Project Rooms**, each containing one or more **Task Rooms** (a scoped space for one piece of work, not a permanent channel).

Ships as both a web app and an Electron desktop app, sharing the same frontend.

## Features

- **Rooms → Task Rooms** — a Room is a team/project (e.g. "Platform Team"); each Room holds several Task Rooms (e.g. "Rework onboarding flow"), which is where the actual chat, agents, and work items live.
- **Agents** — workspace-wide "staff", backed by a real model, with an instructions prompt and a set of granted tools. Reply when `@mentioned` in any Task Room chat, or 1:1 in a **Direct Message**. Role presets (Project Manager, Researcher, UX/UI Designer, Developer, Copywriter) give a working agency team in a few clicks.
- **Handoffs** — when an agent's reply `@mentions` a teammate, that teammate is triggered automatically (chains capped at 8 hops). Every agent sees the team roster, so a Project Manager agent can split a brief into todos and delegate.
- **Files in, files out** — attach files to a chat message (button, paste, or drag & drop); they're stored in the Room's shared project folder. Agents on the Hivemark runtime see images and PDFs natively and read text/data files inline. Agents write deliverables into the same folder and attach them to their reply; images render inline in chat and in the Files panel.
- **Built-in agent tools** (every Task Room turn, Hivemark + OpenRouter runtimes) — `attach_file`, `generate_image` (needs an OpenRouter key; model via `HIVEMARK_IMAGE_MODEL`, default `google/gemini-2.5-flash-image`), and todo management (`list_todos`, `add_todo`, `complete_todo`).
- **Agent Teams** — group agents into a reusable team and clone the whole group into a new Task Room in one action.
- **Agent Runtimes** (Settings → Agent runtimes) — which execution backend an agent uses. All five are real, not cosmetic — see "Agent Runtimes" below. Plus global agent defaults and behavior toggles.
- **Connections** (Settings → Connections) — where you paste your own Anthropic and/or OpenRouter API key, and per-tool credentials (GitHub/Postgres/Slack/Linear); stored locally, never read from an environment variable.
- **Workflows, Loops, Todos** — per-Task-Room. Workflows are a checklist with a draft/running/done status; Loops fire a recurring run of the Task Room's own agents on a schedule, telling them which loop is due; Todos are an assignable list (humans or agents).

## Architecture

A single npm-workspaces monorepo with three packages:

| Package | What it is | Stack |
|---|---|---|
| `apps/web` | The UI | Next.js (static export) + Zustand |
| `apps/server` | The backend | Express + SQLite (`better-sqlite3`) + WebSocket, real Claude API calls, real MCP tool client |
| `apps/desktop` | The desktop shell | Electron; loads `apps/web` and spawns `apps/server` as a child process |

`apps/web` never mocks anything — it's a thin client that calls `apps/server`'s REST API and refetches state on a WebSocket `sync` push. All persistence, Claude calls, and MCP tool execution happen in `apps/server`, backed by a local SQLite file (`apps/server/data/`).

## Prerequisites

- Node.js `>=22`
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

Either way, on first load (with OAuth login not configured) the app seeds itself with demo data (rooms, agents, a workflow, a loop, todos) into `apps/server/data/hivemark.db`.

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
| **Claude Code** | Spawns the real `claude -p` CLI (`apps/server/src/claudeCodeAgent.ts`) | Whatever's logged in for the `claude` CLI on this machine — a **Claude Pro/Max subscription** or an API key | Live, incl. reading attachments and writing files |
| **Codex** | Spawns `npx @agentclientprotocol/codex-acp` and talks to it over the real Agent Client Protocol (`apps/server/src/codexAgent.ts`, using `@agentclientprotocol/sdk`) | Whatever's already configured for the Codex CLI (OPENAI_API_KEY/CODEX_API_KEY env var, or ChatGPT login) | Protocol verified live (handshake/session/prompt all real); no reply seen since no Codex credentials were available to test with |
| **Goose** | Spawns the real `goose run --no-session` CLI (`apps/server/src/gooseAgent.ts`) | Hivemark's stored Anthropic key, passed as `ANTHROPIC_API_KEY` | Live |

For OpenRouter, an agent's Model field switches from the fixed Claude picker to free text — type any model slug OpenRouter hosts, e.g. `openai/gpt-4o`, `anthropic/claude-3.7-sonnet`, `meta-llama/llama-3.1-70b-instruct`.

The Claude Code runtime card in Settings → Agent runtimes shows whether the `claude` CLI is signed in on this machine, with a **Sign in with Claude** button when it isn't. Clicking it runs the real `claude auth login` (opens the user's actual browser to Anthropic's OAuth consent page); the UI polls status every 2s until it detects a successful login. This is a real, supported flow (`claude auth login`/`claude auth status --json`, `apps/server/src/claudeCodeAuth.ts`) — not something reverse-engineered, since Anthropic doesn't offer a public "Sign in with Claude" OAuth flow for third-party apps generally.

**Using a Claude subscription instead of API credits:** pick the Claude Code runtime (per agent, or as the default in Settings → Agent runtimes) and sign in there with your Pro/Max account. Hivemark's grants map onto Claude Code's own tools: in a Task Room it can always read the Room's project folder (so it sees attached images/PDFs), "Files" adds Write/Edit there, "Web research" adds WebSearch/WebFetch, and Bash still needs the server-wide opt-in. The built-in `attach_file` / `generate_image` / todo tools and granted MCP tools (Browser, GitHub, ...) are passed to Claude Code too (`--mcp-config`, with `--strict-mcp-config` so your personal Claude Code MCP servers never load into an agent). Subscriptions are personal: on a shared self-hosted server every Claude Code agent runs on the one login of the server machine, so teams should use API keys there.


Codex and Goose don't use Hivemark's MCP tools. Codex's tool-call permission requests are auto-denied unless the server runs with `ENABLE_AGENT_TOOL_ACCESS=1` **and** the agent is granted "bash-access" — then Codex (like Claude Code's Bash) runs confined to the Room's shared project folder, or in a DM to that person's private DM folder. See `apps/server/src/agentSandbox.ts`.

## MCP tools

Agents can be granted tools from the MCP catalog:

- **Web research** — Anthropic's server-side web search + web fetch (Hivemark Agent runtime only; billed per search by Anthropic).
- **Browser** — spawns the real `@playwright/mcp` server, no credentials needed (but you need `npx playwright install chromium` once for it to actually control a browser).
- **GitHub**, **Postgres**, **Slack** — spawn real MCP servers over stdio (`@modelcontextprotocol/server-github`, `server-postgres`, `slack-mcp-server`), gated on the matching Connections credential.
- **Linear** — Linear's hosted MCP server (`mcp.linear.app`) over Streamable HTTP, using the Linear API key.
- **Files** — the official filesystem MCP server, confined to the Room's shared project folder and the agent's own workspace. In a DM it reaches only that person's private DM folder (`data/dm-workspaces/<agent>/<member>`), so files from a private chat never show up in a room or in someone else's DM; the DM view lists them for that person only.
- **Preview** — lets an agent start/stop its Room's live preview; only available when the server runs with `ENABLE_AGENT_TOOL_ACCESS=1`.

## Loops

A Loop fires recurring runs of the agents created in its Task Room. Schedules: `"Every day at HH:MM"`, `"Every <Weekday> at HH:MM"`, `"Every N minutes/hours/days"`, or a raw cron expression (e.g. `0 9 * * 1-5`). All times are UTC; an unparsable schedule never fires.

## Building for production

```bash
npm run build:web       # static-exports apps/web to apps/web/out
npm run build:desktop   # build:web, then builds apps/server + packages the Electron app
```

`build:desktop` bundles `apps/server`'s compiled `dist/` + `node_modules` into the packaged app (so it doesn't depend on the end user having Node installed), then an `afterPack` hook (`apps/desktop/scripts/afterPack.js`) rebuilds `better-sqlite3`'s native binding against Electron's own Node ABI *for each target architecture* — so the arm64 and x64 DMGs each get the right binary, whichever Mac builds them. The packaged app keeps its database in the OS app-data folder (`HIVEMARK_DATA_DIR`), not inside the app bundle. 

### A gotcha if you touch `apps/desktop/package.json`

`apps/desktop/node_modules` is a **symlink** to the root `node_modules` (`ln -s ../../node_modules apps/desktop/node_modules`) — don't delete it. Without it, electron-builder's packager sees no local `node_modules` in `apps/desktop`, wrongly concludes dependencies aren't installed, and runs its own `npm install --production` scoped to that folder — which prunes `apps/desktop`'s own devDependencies (electron-builder itself included) out from under itself mid-build. If a full clean (`rm -rf node_modules && npm install`) ever removes the symlink, just recreate it before running `build:desktop`.

electron-builder is also pinned to `^25.x`, not `^26.x` — `app-builder-lib@26` added a `@noble/hashes@2.x` dependency that its own code tries to `require()` even though v2 dropped CommonJS support, which breaks packaging outright. 25.x doesn't have that dependency at all.

## Known limitations

- Attachments are Task Room only (not DMs). File contents are sent to the model only for the 10 most recent messages and up to 20 MB in total (newest first); anything else is named, and agents can open it with their file tools. Very long rooms send only the most recent ~400k characters, with a note that older messages exist.
- Codex and Goose don't get the built-in tools or native image input — they see attachment paths and can read them via their own file access.
- The Room's project folder is served unauthenticated under `/preview-static/<roomId>/` so the live preview works in an iframe — except `uploads/` (chat attachments), which is members-only. SVGs served there can't run scripts.
- @mentions (and agent handoffs) only reach agents the sender can see: agents created in a Task Room they're in, or attached to one of their Rooms. A Loop's handoffs stay within its Room.
- Automated tests (`npm test`) cover the server's security fixes and the agent workflow against a mock Claude API, each on a throwaway data folder; the web UI and desktop shell are still verified by hand.
