export type TaskType =
  | "root.save_user_message"
  | "root.memory_retriever"
  | "root.response_agent"
  | "root.save_assistant_message"
  | "orchestrator.invoke"
  | "insights.generate_todo_list";

export type TaskGraph = "root" | "orchestrator";

export function getTaskGraph(taskType: TaskType): TaskGraph {
  if (taskType.startsWith("root.")) return "root";
  return "orchestrator";
}

export function getTaskNodeId(taskType: TaskType): string {
  switch (taskType) {
    case "root.save_user_message":
      return "saveUserMessage";
    case "root.memory_retriever":
      return "memoryRetriever";
    case "root.response_agent":
      return "rootResponseAgent";
    case "root.save_assistant_message":
      return "saveAssistantMessage";
    case "orchestrator.invoke":
      return "orchestrator";
    case "insights.generate_todo_list":
      return "insightsGenerateTodoList";
  }
}
