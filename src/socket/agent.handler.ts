import type { Namespace, Socket } from "socket.io";
import type { ArcService } from "../services/arc.service.js";
import type { AgentService } from "../services/agent.service.js";
import { logger } from "../utils/logger.js";

export function handleAgentSocket(
  socket: Socket,
  arcService: ArcService,
  agentService: AgentService,
  clientNamespace: Namespace,
) {
  const arcId = (socket as any).arcId as string;
  const userId = (socket as any).userId as string;

  socket.on("agent:register", async (data: { arcId: string; capabilities: string[] }) => {
    agentService.registerAgent(data.arcId, userId, socket, data.capabilities);
    await arcService.updateStatus(data.arcId, "ONLINE");
    clientNamespace.emit("arc:status", { arcId: data.arcId, status: "ONLINE" });
    logger.info({ arcId: data.arcId }, "Agent registered");
  });

  socket.on("tool:result", (data) => {
    agentService.handleToolResult(data);
  });

  socket.on("agent:metrics", (data) => {
    clientNamespace.to(`metrics:${data.arcId}`).emit("metrics:update", data);
  });

  socket.on("agent:heartbeat", async () => {
    await arcService.updateLastSeen(arcId);
  });

  socket.on("disconnect", async () => {
    agentService.unregisterAgent(arcId);
    await arcService.updateStatus(arcId, "OFFLINE");
    clientNamespace.emit("arc:status", { arcId, status: "OFFLINE" });
    logger.info({ arcId }, "Agent disconnected");
  });
}
