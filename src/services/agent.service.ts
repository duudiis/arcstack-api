import type { Socket } from "socket.io";
import type { MetricsPayload, ToolResultPayload } from "../types/index.js";

interface ConnectedAgent {
  socket: Socket;
  arcId: string;
  userId: string;
  capabilities: string[];
}

export class AgentService {
  private agents = new Map<string, ConnectedAgent>();
  private pendingToolCalls = new Map<string, (result: ToolResultPayload) => void>();

  registerAgent(arcId: string, userId: string, socket: Socket, capabilities: string[]) {
    this.agents.set(arcId, { socket, arcId, userId, capabilities });
  }

  unregisterAgent(arcId: string) {
    this.agents.delete(arcId);
  }

  getAgent(arcId: string): ConnectedAgent | undefined {
    return this.agents.get(arcId);
  }

  isOnline(arcId: string): boolean {
    return this.agents.has(arcId);
  }

  async executeToolOnAgent(
    arcId: string,
    requestId: string,
    tool: string,
    params: Record<string, unknown>,
    timeoutMs = 30_000,
  ): Promise<ToolResultPayload> {
    const agent = this.agents.get(arcId);
    if (!agent) {
      return {
        arcId,
        requestId,
        success: false,
        output: "",
        error: "Arc agent is offline",
        executionTimeMs: 0,
      };
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingToolCalls.delete(requestId);
        resolve({
          arcId,
          requestId,
          success: false,
          output: "",
          error: "Tool execution timed out",
          executionTimeMs: timeoutMs,
        });
      }, timeoutMs);

      this.pendingToolCalls.set(requestId, (result) => {
        clearTimeout(timer);
        this.pendingToolCalls.delete(requestId);
        resolve(result);
      });

      agent.socket.emit("tool:execute", { arcId, requestId, tool, params });
    });
  }

  handleToolResult(result: ToolResultPayload) {
    const resolver = this.pendingToolCalls.get(result.requestId);
    if (resolver) resolver(result);
  }

  getConnectedArcIds(): string[] {
    return Array.from(this.agents.keys());
  }
}
