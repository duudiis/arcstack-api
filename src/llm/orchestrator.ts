import { randomUUID } from "node:crypto";
import type { BaseProvider, LlmMessage } from "./providers/base.js";
import { TOOL_DEFINITIONS, buildMessages } from "./prompts.js";
import type { AgentService } from "../services/agent.service.js";
import { logger } from "../utils/logger.js";

interface OrchestratorResponse {
  content: string;
  toolName?: string;
  toolData?: Record<string, unknown>;
}

export class LlmOrchestrator {
  constructor(private provider: BaseProvider) {}

  async processMessage(
    arcId: string,
    userMessage: string,
    agentService: AgentService,
  ): Promise<OrchestratorResponse> {
    const messages = buildMessages(userMessage);

    const response = await this.provider.chat(messages, TOOL_DEFINITIONS);

    if (response.toolCalls.length === 0) {
      return { content: response.content ?? "I'm not sure how to help with that." };
    }

    const toolCall = response.toolCalls[0]!;
    const requestId = randomUUID();

    logger.info({ arcId, tool: toolCall.tool, params: toolCall.params }, "Executing tool on agent");

    const toolResult = await agentService.executeToolOnAgent(
      arcId,
      requestId,
      toolCall.tool,
      toolCall.params,
    );

    const resultContent = toolResult.success
      ? toolResult.output
      : `Error: ${toolResult.error ?? "Unknown error"}`;

    const summaryResponse = await this.provider.chatWithToolResult(
      messages,
      toolCall.id,
      resultContent,
      TOOL_DEFINITIONS,
    );

    return {
      content: summaryResponse.content ?? resultContent,
      toolName: toolCall.tool,
      toolData: {
        params: toolCall.params,
        result: {
          success: toolResult.success,
          output: toolResult.output,
          error: toolResult.error,
          executionTimeMs: toolResult.executionTimeMs,
        },
      },
    };
  }
}
