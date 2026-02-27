import assert from "node:assert/strict";
import test from "node:test";

test("todo-generator module loads without error", async () => {
  const mod = await import("./todo-generator");
  assert.ok(mod.TodoGenerator);
  assert.ok(mod.createTodoGenerator);
});
