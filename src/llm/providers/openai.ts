import OpenAI from "openai";
import {
  BaseProvider,
  type LlmMessage,
  type LlmResponse,
  type ToolDefinition,
  type ProviderConfig,
  type ToolCall,
} from "./base.js";

export class OpenAIProvider extends BaseProvider {
  name = "openai";
  private client: OpenAI;
  private model: string;

  constructor(config: ProviderConfig) {
    super(config);
    this.client = new OpenAI({ apiKey: config.apiKey });
    this.model = config.model ?? "gpt-4o-mini";
  }

  private toOpenAIMessages(messages: LlmMessage[]): OpenAI.ChatCompletionMessageParam[] {
    return messages.map((m) => {
      if (m.role === "tool") {
        return {
          role: "tool" as const,
          content: m.content,
          tool_call_id: m.toolCallId!,
        };
      }
      return { role: m.role as "system" | "user" | "assistant", content: m.content };
    });
  }

  private toOpenAITools(
    tools: ToolDefinition[],
  ): OpenAI.ChatCompletionTool[] {
    return tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters as any,
      },
    }));
  }

  private parseResponse(choice: OpenAI.ChatCompletion.Choice): LlmResponse {
    const msg = choice.message;
    const toolCalls: ToolCall[] = (msg.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      tool: tc.function.name,
      params: JSON.parse(tc.function.arguments),
    }));

    return {
      content: msg.content,
      toolCalls,
    };
  }

  async chat(messages: LlmMessage[], tools?: ToolDefinition[]): Promise<LlmResponse> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: this.toOpenAIMessages(messages),
      tools: tools?.length ? this.toOpenAITools(tools) : undefined,
      temperature: 0.3,
    });

    return this.parseResponse(response.choices[0]!);
  }

  async chatWithToolResult(
    messages: LlmMessage[],
    toolCallId: string,
    toolResult: string,
    tools?: ToolDefinition[],
  ): Promise<LlmResponse> {
    const allMessages: LlmMessage[] = [
      ...messages,
      { role: "tool", content: toolResult, toolCallId },
    ];
    return this.chat(allMessages, tools);
  }
}
