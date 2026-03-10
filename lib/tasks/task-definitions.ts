export type TaskType =
  | "orchestrator.invoke"
  | "insights.generate_todo_list"
  | "vault.sync_from_events"
  | "integration.sync";

export type TaskGraph = "orchestrator";

export function getTaskGraph(taskType: TaskType): TaskGraph {
  void taskType;
  return "orchestrator";
}

export function getTaskNodeId(taskType: TaskType): string {
  switch (taskType) {
    case "orchestrator.invoke":
      return "orchestrator";
    case "insights.generate_todo_list":
      return "insightsGenerateTodoList";
    case "vault.sync_from_events":
      return "vaultSyncFromEvents";
    case "integration.sync":
      return "integrationSync";
  }
}
