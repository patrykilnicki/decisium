import assert from "node:assert/strict";
import test from "node:test";
import type { ActivityAtom } from "@/types/database";
import type { TodoItem } from "@/packages/agents/schemas/todo.schema";
import {
  dedupeAndSortItems,
  scoreAtomForTodo,
  toTodoItem,
} from "./todo-generator";

function createAtom(overrides: Partial<ActivityAtom> = {}): ActivityAtom {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    user_id: overrides.user_id ?? crypto.randomUUID(),
    integration_id: overrides.integration_id ?? null,
    provider: overrides.provider ?? "gmail",
    atom_type: overrides.atom_type ?? "message",
    external_id:
      overrides.external_id ?? `ext_${Math.random().toString(36).slice(2)}`,
    title: overrides.title ?? "Follow up with client",
    content: overrides.content ?? "Action required today",
    occurred_at: overrides.occurred_at ?? new Date().toISOString(),
    duration_minutes: overrides.duration_minutes ?? null,
    participants: overrides.participants ?? null,
    source_url: overrides.source_url ?? null,
    embedding_id: overrides.embedding_id ?? null,
    metadata: overrides.metadata ?? null,
    related_atom_ids: overrides.related_atom_ids ?? null,
    importance: overrides.importance ?? null,
    sentiment: overrides.sentiment ?? null,
    categories: overrides.categories ?? null,
    synced_at: overrides.synced_at ?? null,
    created_at: overrides.created_at ?? null,
    updated_at: overrides.updated_at ?? null,
  };
}

test("scoreAtomForTodo boosts urgent language", () => {
  const lowSignal = createAtom({ content: "general note" });
  const highSignal = createAtom({
    content: "urgent action required by tomorrow",
  });

  assert.ok(scoreAtomForTodo(highSignal) > scoreAtomForTodo(lowSignal));
});

test("dedupeAndSortItems keeps first unique provider-title pair", () => {
  const base: TodoItem = {
    id: "1",
    title: "Follow up with client",
    summary: "summary",
    priority: "high",
    status: "open",
    dueAt: null,
    sourceProvider: "gmail",
    sourceType: "message",
    sourceRef: {},
    confidence: 0.9,
    tags: ["gmail"],
    suggestedNextAction: "reply",
  };

  const duplicates: TodoItem[] = [
    base,
    { ...base, id: "2", title: "  follow   up with client " },
    { ...base, id: "3", sourceProvider: "linear" },
  ];

  const result = dedupeAndSortItems(duplicates);
  assert.equal(result.length, 2);
  assert.equal(result[0].sourceProvider, "gmail");
});

test("scoreAtomForTodo remains bounded", () => {
  const atom = createAtom({
    content: "urgent asap deadline action required follow up",
    provider: "linear",
    atom_type: "task",
  });
  const score = scoreAtomForTodo(atom);
  assert.ok(score >= 0 && score <= 1);
});

test("toTodoItem returns valid item for empty title and content", () => {
  const atom = createAtom({ title: "", content: "" });
  const item = toTodoItem(atom);
  assert.equal(item.title, "Untitled");
  assert.equal(item.summary, "No description.");
  assert.ok(item.id);
  assert.ok(item.sourceProvider);
});
