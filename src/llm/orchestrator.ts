import { randomUUID } from "node:crypto";
import type { BaseProvider, LlmMessage, ToolCall } from "./providers/base.js";
import { TOOL_DEFINITIONS, buildMessages, type ArcMode } from "./prompts.js";
import type { AgentService } from "../services/agent.service.js";
import { logger } from "../utils/logger.js";

const MAX_TOOL_ROUNDS = 10;

export interface ChatEvent {
  type: "thinking" | "tool_call" | "tool_result" | "stream" | "done" | "error";
  content?: string;
  toolName?: string;
  toolParams?: Record<string, unknown>;
  toolResult?: { success: boolean; output: string; error?: string; executionTimeMs: number };
  message?: OrchestratorResponse;
}

export interface OrchestratorResponse {
  content: string;
  toolName?: string;
  toolData?: Record<string, unknown>;
  toolCalls?: Array<{
    tool: string;
    params: Record<string, unknown>;
    result: { success: boolean; output: string; error?: string; executionTimeMs: number };
  }>;
}

export class LlmOrchestrator {
  constructor(private provider: BaseProvider) {}

  async processMessage(
    arcId: string,
    userMessage: string,
    agentService: AgentService,
    history: LlmMessage[],
    mode: ArcMode = "default",
    onEvent?: (event: ChatEvent) => void,
  ): Promise<OrchestratorResponse> {
    const messages: LlmMessage[] = buildMessages(userMessage, history, mode);
    const allToolCalls: OrchestratorResponse["toolCalls"] = [];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      onEvent?.({ type: "thinking" });

      const response = await this.provider.chatStream(messages, TOOL_DEFINITIONS, {
        onToken: (token) => onEvent?.({ type: "stream", content: token }),
        onDone: () => {},
      });

      // No tool calls — we have a final text response
      if (response.toolCalls.length === 0) {
        const content = response.content ?? "I'm not sure how to help with that.";
        const result: OrchestratorResponse = { content };
        if (allToolCalls.length > 0) {
          result.toolName = allToolCalls[0]!.tool;
          result.toolData = { calls: allToolCalls };
          result.toolCalls = allToolCalls;
        }
        onEvent?.({ type: "done", message: result });
        return result;
      }

      // Push the assistant message ONCE with all tool_calls
      messages.push({
        role: "assistant",
        content: response.content,
        toolCalls: response.toolCalls,
      });

      // Execute ALL tool calls from this response, collect results
      const toolResults: Array<{ toolCall: ToolCall; content: string }> = [];

      for (const toolCall of response.toolCalls) {
        onEvent?.({ type: "tool_call", toolName: toolCall.tool, toolParams: toolCall.params });

        const requestId = randomUUID();
        logger.info({ arcId, tool: toolCall.tool, params: toolCall.params, round }, "Executing tool on agent");

        const toolResult = await agentService.executeToolOnAgent(
          arcId,
          requestId,
          toolCall.tool,
          toolCall.params,
        );

        onEvent?.({ type: "tool_result", toolName: toolCall.tool, toolResult });

        allToolCalls.push({
          tool: toolCall.tool,
          params: toolCall.params,
          result: {
            success: toolResult.success,
            output: toolResult.output,
            error: toolResult.error,
            executionTimeMs: toolResult.executionTimeMs,
          },
        });

        const resultContent = toolResult.success
          ? toolResult.output
          : `Error: ${toolResult.error ?? "Unknown error"}`;

        toolResults.push({ toolCall, content: resultContent });
      }

      // Push ALL tool result messages (one per tool_call_id)
      for (const { toolCall, content } of toolResults) {
        messages.push({
          role: "tool",
          content,
          toolCallId: toolCall.id,
        });
      }

      // Loop continues — LLM will see results and can respond or call more tools
    }

    // Exceeded max rounds — ask LLM for a final summary without tools
    onEvent?.({ type: "thinking" });
    const finalResponse = await this.provider.chatStream(
      [...messages, { role: "user", content: "Please provide a summary of everything you've done so far." }],
      undefined,
      {
        onToken: (token) => onEvent?.({ type: "stream", content: token }),
        onDone: () => {},
      },
    );

    const content = finalResponse.content ?? "I've completed the requested operations.";
    const result: OrchestratorResponse = {
      content,
      toolName: allToolCalls[0]?.tool,
      toolData: { calls: allToolCalls },
      toolCalls: allToolCalls,
    };
    onEvent?.({ type: "done", message: result });
    return result;
  }
}
