import fs from "node:fs";
import path from "node:path";
import { repo } from "./db.js";
import { getRoomProjectDir, resolveFileInDir, resolveWritePathInDir } from "./agentSandbox.js";
import type { AnthropicToolDef, ToolResult } from "./mcp/manager.js";

// Any OpenRouter model with image output works here (response carries
// `message.images[].image_url.url` data URLs).
const IMAGE_MODEL = process.env.HIVEMARK_IMAGE_MODEL ?? "google/gemini-2.5-flash-image";

/**
 * Hivemark's own in-process tools (no MCP server), given to every agent on a
 * Task Room turn: attach deliverables to its reply, generate images into the
 * Room's project folder, and manage the Task Room's todo list. Unprefixed
 * names, so they can't collide with MCP tools (always `<toolId>__<name>`).
 * `attachments` collects what the agent attached, for the reply message.
 */
export function createWorkspaceTools(taskRoomId: string, roomId: string) {
  const dir = getRoomProjectDir(roomId);
  const attachments: string[] = [];
  const canGenerateImages = !!repo.getConnectionValue("openrouter");

  const defs: AnthropicToolDef[] = [
    {
      name: "attach_file",
      description:
        "Attach a file from the Room's shared project folder to your chat reply, so the team sees it inline (images render, other files are downloadable). Use for finished deliverables.",
      input_schema: {
        type: "object",
        properties: { path: { type: "string", description: "Path relative to the project folder, e.g. designs/hero.png" } },
        required: ["path"],
      },
    },
    ...(canGenerateImages
      ? [
          {
            name: "generate_image",
            description:
              "Generate a raster image (illustration, ad visual, mockup, photo-style shot) from a detailed prompt, save it as a PNG in the project folder and attach it to your reply.",
            input_schema: {
              type: "object",
              properties: {
                prompt: { type: "string", description: "Detailed description: subject, style, composition, colors, text to render" },
                path: { type: "string", description: "Where to save it, e.g. ads/summer-banner.png" },
              },
              required: ["prompt", "path"],
            },
          },
        ]
      : []),
    {
      name: "list_todos",
      description: "List this Task Room's todos with their id, status and assignee.",
      input_schema: { type: "object", properties: {} },
    },
    {
      name: "add_todo",
      description: "Add a todo to this Task Room, optionally assigned to a teammate (agent or human) by name.",
      input_schema: {
        type: "object",
        properties: {
          text: { type: "string" },
          assignee: { type: "string", description: "Name of an agent or member" },
          due_date: { type: "string", description: "YYYY-MM-DD" },
        },
        required: ["text"],
      },
    },
    {
      name: "complete_todo",
      description: "Mark a todo in this Task Room as done.",
      input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    },
  ];

  const ok = (text: string): ToolResult => ({ text, isError: false });
  const fail = (text: string): ToolResult => ({ text, isError: true });

  function nameOf(id: string | null): string {
    if (!id) return "unassigned";
    return repo.getMember(id)?.name ?? repo.getAgent(id)?.name ?? "unknown";
  }

  /** Returns null for a name that isn't one of these tools. */
  async function call(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<ToolResult | null> {
    switch (name) {
      case "attach_file": {
        const rel = String(args.path ?? "");
        const full = resolveFileInDir(dir, rel);
        if (!full) return fail(`No such file in the project folder: ${rel}`);
        attachments.push(path.relative(dir, full).split(path.sep).join("/"));
        return ok(`Attached ${rel}.`);
      }
      case "generate_image": {
        let rel = String(args.path ?? "");
        if (!rel.toLowerCase().endsWith(".png")) rel += ".png";
        const target = resolveWritePathInDir(dir, rel);
        if (!target) return fail(`Invalid path: ${rel}`);
        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          signal,
          headers: { Authorization: `Bearer ${repo.getConnectionValue("openrouter")}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: IMAGE_MODEL,
            modalities: ["image", "text"],
            messages: [{ role: "user", content: String(args.prompt ?? "") }],
          }),
        });
        const body = (await res.json()) as any;
        if (!res.ok) return fail(`Image generation failed (${res.status}): ${body?.error?.message ?? "unknown error"}`);
        const url: string | undefined = body.choices?.[0]?.message?.images?.[0]?.image_url?.url;
        const base64 = url?.split(",")[1];
        if (!base64) return fail("The image model returned no image — try a more concrete prompt.");
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, Buffer.from(base64, "base64"));
        // Normalized like attach_file — the model often passes an absolute path.
        attachments.push(path.relative(dir, target).split(path.sep).join("/"));
        return ok(`Saved and attached ${rel}.`);
      }
      case "list_todos": {
        const todos = repo.getTodosForTaskRoom(taskRoomId);
        if (todos.length === 0) return ok("No todos yet.");
        return ok(
          todos
            .map((t) => `${t.id} [${t.done ? "x" : " "}] ${t.text} — ${nameOf(t.assigneeId)}${t.dueDate ? `, due ${t.dueDate}` : ""}`)
            .join("\n")
        );
      }
      case "add_todo": {
        const who = String(args.assignee ?? "").toLowerCase().replace(/^@/, "");
        let assigneeId: string | null = null;
        if (who) {
          const match =
            repo.getAllAgents().find((a) => a.name.toLowerCase() === who) ??
            repo.getAllMembers().find((m) => m.name.toLowerCase() === who);
          if (!match) return fail(`No agent or member named "${args.assignee}".`);
          assigneeId = match.id;
        }
        const todo = repo.addTodo(taskRoomId, String(args.text ?? ""), assigneeId, args.due_date ? String(args.due_date) : null);
        return ok(`Added todo ${todo.id}.`);
      }
      case "complete_todo": {
        const todo = repo.getTodo(String(args.id ?? ""));
        if (!todo || todo.taskRoomId !== taskRoomId) return fail(`No todo ${args.id} in this Task Room.`);
        if (!todo.done) repo.toggleTodo(todo.id);
        return ok(`Marked ${todo.id} done.`);
      }
      default:
        return null;
    }
  }

  return { defs, call, attachments };
}
