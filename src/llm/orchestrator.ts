import { randomUUID } from "node:crypto";
import type { BaseProvider, LlmMessage, ToolCall } from "./providers/base.js";
import { TOOL_DEFINITIONS, buildMessages, type ArcMode } from "./prompts.js";
import type { AgentService } from "../services/agent.service.js";
import type { WebService } from "../services/web.service.js";
import { logger } from "../utils/logger.js";

const MAX_TOOL_ROUNDS = 10;

const SERVER_TOOLS = new Set(["web_search", "web_fetch"]);

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
  private activeAborts = new Map<string, AbortController>();

  constructor(
    private provider: BaseProvider,
    private webService?: WebService,
  ) {}

  private async executeServerTool(
    toolName: string,
    params: Record<string, unknown>,
  ): Promise<{ success: boolean; output: string; error?: string; executionTimeMs: number }> {
    const start = Date.now();

    try {
      if (toolName === "web_search" && this.webService) {
        const query = (params.query as string) ?? "";
        const count = (params.count as number) ?? 5;
        const results = await this.webService.search(query, count);
        if (results.length === 0) {
          return { success: true, output: "No results found.", executionTimeMs: Date.now() - start };
        }
        const formatted = results.map((r, i) =>
          `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`
        ).join("\n\n");
        return { success: true, output: formatted, executionTimeMs: Date.now() - start };
      }

      if (toolName === "web_fetch" && this.webService) {
        const url = (params.url as string) ?? "";
        const result = await this.webService.fetch(url);
        if (!result.content) {
          return { success: false, output: "", error: `Failed to fetch ${url}`, executionTimeMs: Date.now() - start };
        }
        return { success: true, output: result.content, executionTimeMs: Date.now() - start };
      }

      return { success: false, output: "", error: `Unknown server tool: ${toolName}`, executionTimeMs: Date.now() - start };
    } catch (err) {
      return { success: false, output: "", error: String(err), executionTimeMs: Date.now() - start };
    }
  }

  async processMessage(
    arcId: string,
    userMessage: string,
    agentService: AgentService,
    history: LlmMessage[],
    mode: ArcMode = "default",
    onEvent?: (event: ChatEvent) => void,
    model?: string,
  ): Promise<OrchestratorResponse> {
    const abortController = new AbortController();
    const { signal } = abortController;
    const conversationKey = `${arcId}`;
    this.activeAborts.set(conversationKey, abortController);

    try {
      return await this._processMessageInner(arcId, userMessage, agentService, history, mode, onEvent, model, signal);
    } finally {
      this.activeAborts.delete(conversationKey);
    }
  }

  abortProcessing(arcId: string): boolean {
    const controller = this.activeAborts.get(arcId);
    if (controller) {
      controller.abort();
      return true;
    }
    return false;
  }

  private async _processMessageInner(
    arcId: string,
    userMessage: string,
    agentService: AgentService,
    history: LlmMessage[],
    mode: ArcMode = "default",
    onEvent?: (event: ChatEvent) => void,
    model?: string,
    signal?: AbortSignal,
  ): Promise<OrchestratorResponse> {
    const messages: LlmMessage[] = buildMessages(userMessage, history, mode);
    const allToolCalls: OrchestratorResponse["toolCalls"] = [];
    const chatOpts = model ? { model } : undefined;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      if (signal?.aborted) {
        return this._buildAbortedResponse(allToolCalls);
      }

      onEvent?.({ type: "thinking" });

      const response = await this.provider.chatStream(messages, TOOL_DEFINITIONS, {
        onToken: (token) => onEvent?.({ type: "stream", content: token }),
        onDone: () => {},
        signal,
      }, chatOpts);

      // No tool calls — we have a final text response (or was aborted mid-stream)
      if (response.toolCalls.length === 0 || signal?.aborted) {
        const content = response.content ?? (signal?.aborted ? "*Generation stopped by user.*" : "I'm not sure how to help with that.");
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

        let toolResult: { success: boolean; output: string; error?: string; executionTimeMs: number };

        if (SERVER_TOOLS.has(toolCall.tool)) {
          toolResult = await this.executeServerTool(toolCall.tool, toolCall.params);
        } else {
          if (signal?.aborted) {
            return this._buildAbortedResponse(allToolCalls);
          }

          const requestId = randomUUID();
          logger.info({ arcId, tool: toolCall.tool, params: toolCall.params, round }, "Executing tool on agent");

          toolResult = await agentService.executeToolOnAgent(
            arcId,
            requestId,
            toolCall.tool,
            toolCall.params,
          );
        }

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
    if (signal?.aborted) {
      return this._buildAbortedResponse(allToolCalls);
    }

    onEvent?.({ type: "thinking" });
    const finalResponse = await this.provider.chatStream(
      [...messages, { role: "user", content: "Please provide a summary of everything you've done so far." }],
      undefined,
      {
        onToken: (token) => onEvent?.({ type: "stream", content: token }),
        onDone: () => {},
        signal,
      },
      chatOpts,
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

  private _buildAbortedResponse(allToolCalls: OrchestratorResponse["toolCalls"]): OrchestratorResponse {
    const result: OrchestratorResponse = { content: "*Generation stopped by user.*" };
    if (allToolCalls && allToolCalls.length > 0) {
      result.toolName = allToolCalls[0]!.tool;
      result.toolData = { calls: allToolCalls };
      result.toolCalls = allToolCalls;
    }
    return result;
  }
}
