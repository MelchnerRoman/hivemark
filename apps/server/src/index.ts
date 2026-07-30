import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { repo } from "./db.js";
import { bus } from "./events.js";
import { runAgentTurn } from "./claudeAgent.js";
import { startScheduler } from "./scheduler.js";
import type { ConnectionKey } from "./types.js";

const PORT = Number(process.env.PORT ?? 4001);

const app = express();
app.use(cors());
app.use(express.json());

function handle(fn: (req: express.Request<Record<string, string>>, res: express.Response) => unknown) {
  return async (req: express.Request<Record<string, string>>, res: express.Response) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  };
}

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get(
  "/api/state",
  handle((_req, res) => res.json(repo.getState()))
);

// --- rooms ---
app.post(
  "/api/rooms",
  handle((req, res) => {
    const { name, emoji } = req.body;
    const room = repo.createRoom(name, emoji);
    bus.emit("sync");
    res.json(room);
  })
);
app.post(
  "/api/rooms/:roomId/members",
  handle((req, res) => {
    repo.addMemberToRoom(req.params.roomId, req.body.memberId);
    bus.emit("sync");
    res.json({ ok: true });
  })
);
app.delete(
  "/api/rooms/:roomId/members/:memberId",
  handle((req, res) => {
    repo.removeMemberFromRoom(req.params.roomId, req.params.memberId);
    bus.emit("sync");
    res.json({ ok: true });
  })
);

// --- task rooms ---
app.post(
  "/api/task-rooms",
  handle((req, res) => {
    const { roomId, name, emoji } = req.body;
    const taskRoom = repo.createTaskRoom(roomId, name, emoji);
    bus.emit("sync");
    res.json(taskRoom);
  })
);
app.patch(
  "/api/task-rooms/:id",
  handle((req, res) => {
    repo.setTaskRoomStatus(req.params.id, req.body.status);
    bus.emit("sync");
    res.json({ ok: true });
  })
);

// --- messages (task room chat) ---
app.post(
  "/api/task-rooms/:id/messages",
  handle((req, res) => {
    const taskRoomId = req.params.id;
    const content: string = req.body.content;
    const agents = repo.getAgentsForTaskRoom(taskRoomId);
    const mentioned = agents.filter((a) => content.toLowerCase().includes(`@${a.name.toLowerCase()}`));

    const message = repo.addMessage(
      taskRoomId,
      "member",
      repo.currentMemberId,
      content,
      mentioned.map((a) => a.id)
    );
    bus.emit("sync");
    res.json(message);

    for (const agent of mentioned) {
      runAgentTurn(agent.id, { kind: "task_room", taskRoomId }).catch((err) =>
        console.error("agent turn failed", err)
      );
    }
  })
);

// --- direct messages ---
app.post(
  "/api/agents/:agentId/dm",
  handle((req, res) => {
    const agentId = req.params.agentId;
    const message = repo.addDirectMessage(agentId, "member", req.body.content);
    bus.emit("sync");
    res.json(message);
    runAgentTurn(agentId, { kind: "dm", agentId }).catch((err) => console.error("agent turn failed", err));
  })
);

// --- agents ---
app.post(
  "/api/agents",
  handle((req, res) => {
    const agent = repo.createAgent(req.body);
    bus.emit("sync");
    res.json(agent);
  })
);
app.patch(
  "/api/agents/:agentId/tools/:toolId",
  handle((req, res) => {
    repo.toggleAgentTool(req.params.agentId, req.params.toolId);
    bus.emit("sync");
    res.json({ ok: true });
  })
);
app.delete(
  "/api/agents/:agentId",
  handle((req, res) => {
    repo.removeAgent(req.params.agentId);
    bus.emit("sync");
    res.json({ ok: true });
  })
);
app.post(
  "/api/agents/:agentId/run",
  handle((req, res) => {
    const agent = repo.getAgent(req.params.agentId);
    if (!agent) return res.status(404).json({ error: "agent not found" });
    res.json({ ok: true });
    runAgentTurn(agent.id, { kind: "task_room", taskRoomId: agent.taskRoomId }).catch((err) =>
      console.error("agent turn failed", err)
    );
  })
);
app.post(
  "/api/agents/:agentId/stop",
  handle((req, res) => {
    repo.setAgentStatus(req.params.agentId, "idle");
    bus.emit("sync");
    res.json({ ok: true });
  })
);
app.post(
  "/api/agents/stop-all",
  handle((_req, res) => {
    for (const agent of repo.getState().agents) {
      if (agent.status === "running") repo.setAgentStatus(agent.id, "idle");
    }
    bus.emit("sync");
    res.json({ ok: true });
  })
);

// --- agent teams ---
app.post(
  "/api/agent-teams",
  handle((req, res) => {
    const { name, agentIds, mode } = req.body;
    const team = repo.createAgentTeam(name, agentIds, mode);
    bus.emit("sync");
    res.json(team);
  })
);
app.delete(
  "/api/agent-teams/:teamId",
  handle((req, res) => {
    repo.removeAgentTeam(req.params.teamId);
    bus.emit("sync");
    res.json({ ok: true });
  })
);
app.post(
  "/api/agent-teams/:teamId/add-to-room",
  handle((req, res) => {
    const clones = repo.addTeamToTaskRoom(req.params.teamId, req.body.taskRoomId);
    bus.emit("sync");
    res.json(clones);
  })
);

// --- workflows ---
app.post(
  "/api/workflows",
  handle((req, res) => {
    const { taskRoomId, name, description } = req.body;
    const workflow = repo.createWorkflow(taskRoomId, name, description ?? "");
    bus.emit("sync");
    res.json(workflow);
  })
);
app.post(
  "/api/workflows/:id/steps",
  handle((req, res) => {
    repo.addWorkflowStep(req.params.id, req.body.name);
    bus.emit("sync");
    res.json({ ok: true });
  })
);
app.patch(
  "/api/workflows/:id/steps/:stepId",
  handle((req, res) => {
    repo.toggleWorkflowStep(req.params.id, req.params.stepId);
    bus.emit("sync");
    res.json({ ok: true });
  })
);
app.post(
  "/api/workflows/:id/complete",
  handle((req, res) => {
    repo.markWorkflowDone(req.params.id);
    bus.emit("sync");
    res.json({ ok: true });
  })
);
app.delete(
  "/api/workflows/:id",
  handle((req, res) => {
    repo.removeWorkflow(req.params.id);
    bus.emit("sync");
    res.json({ ok: true });
  })
);

// --- loops ---
app.post(
  "/api/loops",
  handle((req, res) => {
    const { taskRoomId, name, schedule } = req.body;
    const loop = repo.createLoop(taskRoomId, name, schedule);
    bus.emit("sync");
    res.json(loop);
  })
);
app.patch(
  "/api/loops/:id/toggle",
  handle((req, res) => {
    repo.toggleLoopActive(req.params.id);
    bus.emit("sync");
    res.json({ ok: true });
  })
);
app.delete(
  "/api/loops/:id",
  handle((req, res) => {
    repo.removeLoop(req.params.id);
    bus.emit("sync");
    res.json({ ok: true });
  })
);

// --- todos ---
app.post(
  "/api/todos",
  handle((req, res) => {
    const { taskRoomId, text, assigneeId, dueDate } = req.body;
    const todo = repo.addTodo(taskRoomId, text, assigneeId ?? null, dueDate ?? null);
    bus.emit("sync");
    res.json(todo);
  })
);
app.patch(
  "/api/todos/:id/toggle",
  handle((req, res) => {
    repo.toggleTodo(req.params.id);
    bus.emit("sync");
    res.json({ ok: true });
  })
);

// --- agent defaults / behavior settings / runtimes ---
app.put(
  "/api/agent-defaults",
  handle((req, res) => {
    repo.setAgentDefaults(req.body);
    bus.emit("sync");
    res.json({ ok: true });
  })
);
app.patch(
  "/api/agent-behavior-settings",
  handle((req, res) => {
    const { key, value } = req.body;
    repo.setAgentBehaviorSetting(key, value);
    bus.emit("sync");
    res.json({ ok: true });
  })
);
app.post(
  "/api/agent-runtimes/:id/install",
  handle((req, res) => {
    repo.installRuntime(req.params.id);
    bus.emit("sync");
    res.json({ ok: true });
  })
);

// --- connections (credentials) ---
const VALID_KEYS: ConnectionKey[] = ["anthropic", "github", "postgres", "slack", "linear"];
app.put(
  "/api/connections/:key",
  handle((req, res) => {
    const key = req.params.key as ConnectionKey;
    if (!VALID_KEYS.includes(key)) return res.status(400).json({ error: "unknown connection key" });
    const value = String(req.body.value ?? "").trim();
    if (!value) return res.status(400).json({ error: "value required" });
    repo.setConnection(key, value);
    bus.emit("sync");
    res.json({ ok: true });
  })
);
app.delete(
  "/api/connections/:key",
  handle((req, res) => {
    const key = req.params.key as ConnectionKey;
    if (!VALID_KEYS.includes(key)) return res.status(400).json({ error: "unknown connection key" });
    repo.removeConnection(key);
    bus.emit("sync");
    res.json({ ok: true });
  })
);

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

bus.on("sync", () => {
  const payload = JSON.stringify({ type: "sync" });
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(payload);
  }
});

httpServer.listen(PORT, () => {
  console.log(`Hivemark server listening on http://localhost:${PORT}`);
  startScheduler();
});
