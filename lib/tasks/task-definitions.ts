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
  | "orchestrator.save_messages"
  | "daily.classifier_agent"
  | "daily.memory_retriever"
  | "daily.response_agent"
  | "daily.note_acknowledgment"
  | "daily.suggest_ask_ai"
  | "daily.save_events";

export type TaskGraph = "root" | "orchestrator" | "daily";

export function getTaskGraph(taskType: TaskType): TaskGraph {
  if (taskType.startsWith("root.")) return "root";
  if (taskType.startsWith("orchestrator.")) return "orchestrator";
  return "daily";
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
    case "daily.classifier_agent":
      return "classifierAgent";
    case "daily.memory_retriever":
      return "memoryRetriever";
    case "daily.response_agent":
      return "dailyResponseAgent";
    case "daily.note_acknowledgment":
      return "noteAcknowledgment";
    case "daily.suggest_ask_ai":
      return "suggestAskAi";
    case "daily.save_events":
      return "saveEvents";
  }
}
