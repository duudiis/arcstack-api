export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  toolCallId?: string;
  toolCalls?: ToolCall[];
  name?: string;
}

export interface ToolCall {
  id: string;
  tool: string;
  params: Record<string, unknown>;
}

export interface LlmResponse {
  content: string | null;
  toolCalls: ToolCall[];
}

export interface LlmStreamCallbacks {
  onToken: (token: string) => void;
  onDone: (fullContent: string) => void;
  signal?: AbortSignal;
}

export interface ProviderConfig {
  apiKey: string;
  model?: string;
}

export interface ChatOptions {
  model?: string;
}

export abstract class BaseProvider {
  abstract name: string;

  constructor(protected config: ProviderConfig) {}

  abstract chat(
    messages: LlmMessage[],
    tools?: ToolDefinition[],
    options?: ChatOptions,
  ): Promise<LlmResponse>;

  abstract chatStream(
    messages: LlmMessage[],
    tools?: ToolDefinition[],
    callbacks?: LlmStreamCallbacks,
    options?: ChatOptions,
  ): Promise<LlmResponse>;
}
