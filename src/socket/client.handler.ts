import type { Namespace, Socket } from "socket.io";
import type { ArcService } from "../services/arc.service.js";
import type { AgentService } from "../services/agent.service.js";
import type { LlmOrchestrator } from "../llm/orchestrator.js";
import { logger } from "../utils/logger.js";

export function handleClientSocket(
  socket: Socket,
  arcService: ArcService,
  agentService: AgentService,
  orchestrator: LlmOrchestrator,
  clientNamespace: Namespace,
) {
  const userId = (socket as any).userId as string;

  socket.on("chat:send", async (data: { arcId: string; content: string }) => {
    try {
      const arc = await arcService.getById(data.arcId, userId);
      if (!arc) {
        socket.emit("error", { code: "NOT_FOUND", message: "Arc not found" });
        return;
      }

      await arcService.createMessage(data.arcId, "USER", data.content);

      socket.emit("chat:message", {
        id: "",
        role: "USER" as const,
        content: data.content,
        toolName: null,
        toolData: null,
        createdAt: new Date().toISOString(),
      });

      const response = await orchestrator.processMessage(data.arcId, data.content, agentService);

      const saved = await arcService.createMessage(
        data.arcId,
        "ARC",
        response.content,
        response.toolName,
        response.toolData,
      );

      socket.emit("chat:message", {
        id: saved.id,
        role: "ARC" as const,
        content: saved.content,
        toolName: saved.toolName,
        toolData: saved.toolData,
        createdAt: saved.createdAt.toISOString(),
      });
    } catch (err) {
      logger.error(err, "Error processing chat message");
      socket.emit("error", { code: "INTERNAL", message: "Failed to process message" });
    }
  });

  socket.on("metrics:subscribe", (data: { arcId: string }) => {
    socket.join(`metrics:${data.arcId}`);
  });

  socket.on("metrics:unsubscribe", (data: { arcId: string }) => {
    socket.leave(`metrics:${data.arcId}`);
  });

  socket.on("disconnect", () => {
    logger.debug({ userId }, "Client disconnected");
  });
}
