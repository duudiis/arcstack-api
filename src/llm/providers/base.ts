export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
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

export interface ProviderConfig {
  apiKey: string;
  model?: string;
}

export abstract class BaseProvider {
  abstract name: string;

  constructor(protected config: ProviderConfig) {}

  abstract chat(
    messages: LlmMessage[],
    tools?: ToolDefinition[],
  ): Promise<LlmResponse>;

  abstract chatWithToolResult(
    messages: LlmMessage[],
    toolCallId: string,
    toolResult: string,
    tools?: ToolDefinition[],
  ): Promise<LlmResponse>;
}
