"use client";

import { FormEvent, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useStore } from "@/lib/store";
import { AGENT_COLOR_OPTIONS, AGENT_EMOJI_OPTIONS, AGENT_MODEL_OPTIONS } from "@/lib/agent-constants";
import { RuntimeSelect } from "@/components/agents/RuntimeSelect";

export function CreateAgentModal({
  open,
  onClose,
  taskRoomId,
}: {
  open: boolean;
  onClose: () => void;
  /** Omit when opening from a global context (e.g. the Agents gallery) so the
   * form asks which Task Room the agent should belong to. */
  taskRoomId?: string;
}) {
  return (
    <Modal open={open} onClose={onClose} title="New AI Agent">
      {/* Keyed on `open` so each time the modal opens it remounts with fresh
          defaults as its initial state, instead of syncing via effect. */}
      {open && <CreateAgentForm key={String(open)} onClose={onClose} fixedTaskRoomId={taskRoomId} />}
    </Modal>
  );
}

function CreateAgentForm({
  onClose,
  fixedTaskRoomId,
}: {
  onClose: () => void;
  fixedTaskRoomId?: string;
}) {
  const createAgent = useStore((s) => s.createAgent);
  const agentDefaults = useStore((s) => s.agentDefaults);
  const taskRooms = useStore((s) => s.taskRooms);
  const rooms = useStore((s) => s.rooms);
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState(agentDefaults.instructions);
  const [color, setColor] = useState(AGENT_COLOR_OPTIONS[0]);
  const [emoji, setEmoji] = useState(AGENT_EMOJI_OPTIONS[0]);
  const [model, setModel] = useState(agentDefaults.model);
  const [runtimeId, setRuntimeId] = useState(agentDefaults.runtimeId);
  const [taskRoomId, setTaskRoomId] = useState(fixedTaskRoomId ?? taskRooms[0]?.id ?? "");

  const needsTaskRoomPicker = !fixedTaskRoomId;
  const canSubmit = name.trim().length > 0 && taskRoomId.length > 0;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    createAgent(taskRoomId, name.trim(), instructions.trim(), color, emoji, model, runtimeId);
    onClose();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {needsTaskRoomPicker && (
        <div>
          <label className="mb-1.5 block text-xs font-medium text-foreground-muted">Task Room</label>
          {taskRooms.length === 0 ? (
            <p className="text-xs text-foreground-muted">Create a Task Room first, then come back to add an agent.</p>
          ) : (
            <select
              value={taskRoomId}
              onChange={(e) => setTaskRoomId(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
            >
              {taskRooms.map((tr) => {
                const room = rooms.find((r) => r.id === tr.roomId);
                return (
                  <option key={tr.id} value={tr.id}>
                    {room?.emoji} {room?.name} · {tr.emoji} {tr.name}
                  </option>
                );
              })}
            </select>
          )}
        </div>
      )}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-foreground-muted">Agent name</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Release Notes Writer"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
        />
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-medium text-foreground-muted">Instructions</label>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="What should this agent do within this task room?"
          rows={3}
          className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
        />
      </div>
      <RuntimeSelect value={runtimeId} onChange={setRuntimeId} />
      <div>
        <label className="mb-1.5 block text-xs font-medium text-foreground-muted">Model</label>
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
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-medium text-foreground-muted">Avatar</label>
        <div className="flex flex-wrap gap-1.5">
          {AGENT_EMOJI_OPTIONS.map((opt) => (
            <button
              type="button"
              key={opt}
              onClick={() => setEmoji(opt)}
              className={`flex h-8 w-8 items-center justify-center rounded-full border text-base ${
                emoji === opt ? "border-brand bg-brand-soft" : "border-border hover:bg-surface-raised"
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-medium text-foreground-muted">Color</label>
        <div className="flex gap-1.5">
          {AGENT_COLOR_OPTIONS.map((c) => (
            <button
              type="button"
              key={c}
              onClick={() => setColor(c)}
              className={`h-7 w-7 rounded-full border-2 ${color === c ? "border-foreground" : "border-transparent"}`}
              style={{ backgroundColor: c }}
              aria-label={`Choose color ${c}`}
            />
          ))}
        </div>
      </div>
      <p className="text-xs text-foreground-muted">
        You can grant MCP tool access to this agent after it&apos;s created.
      </p>
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canSubmit}>
          Create agent
        </Button>
      </div>
    </form>
  );
}
