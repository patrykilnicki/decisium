export type TaskType =
  | "root.save_user_message"
  | "root.memory_retriever"
  | "root.response_agent"
  | "root.save_assistant_message"
  | "orchestrator.router"
  | "orchestrator.tool_executor"
  | "orchestrator.grade_documents"
  | "orchestrator.rewrite_query"
  | "orchestrator.synthesize"
  | "orchestrator.save_messages";

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
    case "orchestrator.router":
      return "router";
    case "orchestrator.tool_executor":
      return "toolExecutor";
    case "orchestrator.grade_documents":
      return "gradeDocuments";
    case "orchestrator.rewrite_query":
      return "rewriteQuery";
    case "orchestrator.synthesize":
      return "synthesize";
    case "orchestrator.save_messages":
      return "saveMessages";
  }
}
