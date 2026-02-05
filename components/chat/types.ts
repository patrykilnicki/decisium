// Chat message roles
export type ChatRole = "user" | "assistant" | "system";

// Thinking step status states
export type ThinkingStepStatus = "pending" | "running" | "completed" | "error";

// Individual step in the thinking process
export interface ThinkingStep {
  stepId: string;
  label: string;
  status: ThinkingStepStatus;
  timestamp?: number;
}

// Base message interface
export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt?: string;
}

// Thinking state for loading messages
export interface ThinkingState {
  isThinking: boolean;
  steps: ThinkingStep[];
  streamedContent?: string;
}

// Chat input props
export interface ChatInputProps {
  onSend: (message: string) => Promise<void>;
  disabled?: boolean;
  placeholder?: string;
  isLoading?: boolean;
  /** "default" = compact with send only; "full" = wide with mic left, send right (Figma daily style) */
  variant?: "default" | "full";
}

// Chat message props
export interface ChatMessageProps {
  message: ChatMessage;
  showAvatar?: boolean;
  isStreaming?: boolean;
}

// Thinking message props
export interface ThinkingMessageProps {
  steps: ThinkingStep[];
  streamedContent?: string;
  isVisible: boolean;
}

// Chat container props
export interface ChatContainerProps {
  messages: ChatMessage[];
  thinkingState?: ThinkingState;
  onSend: (message: string) => Promise<void>;
  isLoading?: boolean;
  placeholder?: string;
  emptyStateTitle?: string;
  emptyStateDescription?: string;
  /** Custom empty state content (overrides emptyStateTitle/Description when set) */
  emptyState?: React.ReactNode;
}

// SSE event types for streaming
export type StreamEventType =
  | "run_started"
  | "step_started"
  | "step_completed"
  | "step_error"
  | "message_content"
  | "run_finished"
  | "run_error";

// SSE event payload
export interface StreamEvent {
  type: StreamEventType;
  stepId?: string;
  label?: string;
  content?: string;
  error?: string;
  timestamp: number;
  userMessage?: ChatMessage;
  assistantMessage?: ChatMessage;
}

// useChat hook configuration
export interface UseChatConfig {
  apiEndpoint: string;
  mode?: "stream" | "task";
  sessionId?: string;
  tasksEndpoint?: string;
  tasksStreamEndpoint?: string;
  taskStreamEnabled?: boolean;
  taskStreamReconnectMs?: number;
  messagesEndpoint?: string;
  pollIntervalMs?: number;
  initialMessages?: ChatMessage[];
  onMessageSent?: (message: ChatMessage) => void;
  onMessageReceived?: (message: ChatMessage) => void;
  onError?: (error: string) => void;
}

// useChat hook return type
export interface UseChatReturn {
  messages: ChatMessage[];
  thinkingState: ThinkingState;
  sendMessage: (content: string) => Promise<void>;
  isLoading: boolean;
  error: string | null;
  reset: () => void;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  tasks?: Array<{
    id: string;
    taskType: string;
    status: string;
    lastError?: string | null;
    parentTaskId?: string | null;
    createdAt: string;
  }>;
  retryTask?: (taskId: string) => Promise<void>;
  cancelTask?: (taskId: string) => Promise<void>;
}
