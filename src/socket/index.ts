import { Server as SocketServer } from "socket.io";
import type { Server as HttpServer } from "node:http";
import { createClientSocketAuth, createAgentSocketAuth } from "./auth.middleware.js";
import { handleClientSocket } from "./client.handler.js";
import { handleAgentSocket } from "./agent.handler.js";
import type { AuthService } from "../services/auth.service.js";
import type { ArcService } from "../services/arc.service.js";
import type { AgentService } from "../services/agent.service.js";
import type { LlmOrchestrator } from "../llm/orchestrator.js";
import { config } from "../config.js";

export function setupSocketServer(
  httpServer: HttpServer,
  authService: AuthService,
  arcService: ArcService,
  agentService: AgentService,
  orchestrator: LlmOrchestrator,
): SocketServer {
  const io = new SocketServer(httpServer, {
    cors: {
      origin: config.FRONTEND_URL,
      credentials: true,
    },
    pingInterval: 25000,
    pingTimeout: 60000,
  });

  const clientNs = io.of("/client");
  const agentNs = io.of("/agent");

  clientNs.use(createClientSocketAuth(authService));
  agentNs.use(createAgentSocketAuth(arcService));

  clientNs.on("connection", (socket) => {
    handleClientSocket(socket, arcService, agentService, orchestrator, clientNs);
  });

  agentNs.on("connection", (socket) => {
    handleAgentSocket(socket, arcService, agentService, clientNs);
  });

  return io;
}
