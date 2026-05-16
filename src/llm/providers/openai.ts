import OpenAI from "openai";
import {
  BaseProvider,
  type LlmMessage,
  type LlmResponse,
  type LlmStreamCallbacks,
  type ToolDefinition,
  type ProviderConfig,
  type ToolCall,
  type ChatOptions,
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
          content: m.content ?? "",
          tool_call_id: m.toolCallId!,
        };
      }
      if (m.role === "assistant" && m.toolCalls?.length) {
        return {
          role: "assistant" as const,
          content: m.content ?? null,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: {
              name: tc.tool,
              arguments: JSON.stringify(tc.params),
            },
          })),
        };
      }
      return { role: m.role as "system" | "user" | "assistant", content: m.content ?? "" };
    });
  }

  private toOpenAITools(tools: ToolDefinition[]): OpenAI.ChatCompletionTool[] {
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

    return { content: msg.content, toolCalls };
  }

  async chat(messages: LlmMessage[], tools?: ToolDefinition[], options?: ChatOptions): Promise<LlmResponse> {
    const response = await this.client.chat.completions.create({
      model: options?.model ?? this.model,
      messages: this.toOpenAIMessages(messages),
      tools: tools?.length ? this.toOpenAITools(tools) : undefined,
      temperature: 0.3,
    });

    return this.parseResponse(response.choices[0]!);
  }

  async chatStream(
    messages: LlmMessage[],
    tools?: ToolDefinition[],
    callbacks?: LlmStreamCallbacks,
    options?: ChatOptions,
  ): Promise<LlmResponse> {
    const stream = await this.client.chat.completions.create({
      model: options?.model ?? this.model,
      messages: this.toOpenAIMessages(messages),
      tools: tools?.length ? this.toOpenAITools(tools) : undefined,
      temperature: 0.3,
      stream: true,
    });

    let content = "";
    const toolCallChunks = new Map<number, { id: string; name: string; args: string }>();

    try {
      for await (const chunk of stream) {
        if (callbacks?.signal?.aborted) {
          stream.controller.abort();
          break;
        }

        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          content += delta.content;
          callbacks?.onToken(delta.content);
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (!toolCallChunks.has(tc.index)) {
              toolCallChunks.set(tc.index, { id: tc.id ?? "", name: tc.function?.name ?? "", args: "" });
            }
            const existing = toolCallChunks.get(tc.index)!;
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name = tc.function.name;
            if (tc.function?.arguments) existing.args += tc.function.arguments;
          }
        }
      }
    } catch (err: any) {
      if (err?.name === "AbortError" || callbacks?.signal?.aborted) {
        // Aborted — return whatever content we have so far
      } else {
        throw err;
      }
    }

    callbacks?.onDone(content);

    const toolCalls: ToolCall[] = Array.from(toolCallChunks.values()).map((tc) => ({
      id: tc.id,
      tool: tc.name,
      params: tc.args ? JSON.parse(tc.args) : {},
    }));

    return { content: content || null, toolCalls };
  }
}
