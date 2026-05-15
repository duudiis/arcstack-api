import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { AuthService } from "../services/auth.service.js";
import { ArcService } from "../services/arc.service.js";
import { AgentService } from "../services/agent.service.js";
import type { LlmOrchestrator } from "../llm/orchestrator.js";
import { logger } from "../utils/logger.js";

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const cookies: Record<string, string> = {};
  for (const pair of header.split(";")) {
    const [key, ...rest] = pair.split("=");
    if (key) cookies[key.trim()] = rest.join("=").trim();
  }
  return cookies;
}

interface WsMessage {
  type: string;
  [key: string]: unknown;
}

interface ClientConnection {
  ws: WebSocket;
  userId: string;
  subscribedMetrics: Set<string>;
}

interface AgentConnection {
  ws: WebSocket;
  arcId: string;
  userId: string;
}

const clients = new Map<WebSocket, ClientConnection>();
const agents = new Map<string, AgentConnection>();

export function broadcastToClients(type: string, data: Record<string, unknown>) {
  const msg = JSON.stringify({ type, ...data });
  for (const [, client] of clients) {
    if (client.ws.readyState === 1) {
      client.ws.send(msg);
    }
  }
}

export function sendToMetricsSubscribers(arcId: string, data: Record<string, unknown>) {
  const msg = JSON.stringify({ type: "metrics:update", ...data, arcId });
  for (const [, client] of clients) {
    if (client.subscribedMetrics.has(arcId) && client.ws.readyState === 1) {
      client.ws.send(msg);
    }
  }
}

export function sendToClient(ws: WebSocket, type: string, data: Record<string, unknown>) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify({ type, ...data }));
  }
}

export async function setupWebSockets(
  app: FastifyInstance,
  authService: AuthService,
  arcService: ArcService,
  agentService: AgentService,
  orchestrator: LlmOrchestrator,
) {
  // Client WebSocket endpoint
  app.get("/ws/client", { websocket: true }, async (socket, request) => {
    const cookies = parseCookies(request.headers.cookie);
    const token = cookies.access_token;

    if (!token) {
      socket.close(4001, "Authentication required");
      return;
    }

    let userId: string;
    try {
      const payload = await authService.verifyAccessToken(token);
      userId = payload.sub;
    } catch {
      socket.close(4001, "Invalid token");
      return;
    }

    const conn: ClientConnection = { ws: socket, userId, subscribedMetrics: new Set() };
    clients.set(socket, conn);
    logger.info({ userId }, "Client connected");

    socket.on("message", async (raw) => {
      try {
        const msg: WsMessage = JSON.parse(raw.toString());
        await handleClientMessage(conn, msg, arcService, agentService, orchestrator);
      } catch (err) {
        sendToClient(socket, "error", { code: "PARSE_ERROR", message: "Invalid message format" });
      }
    });

    socket.on("close", () => {
      clients.delete(socket);
      logger.debug({ userId }, "Client disconnected");
    });
  });

  // Agent WebSocket endpoint
  app.get("/ws/agent", { websocket: true }, async (socket, request) => {
    const agentToken = (request.query as Record<string, string>).token;

    if (!agentToken) {
      socket.close(4001, "Agent token required");
      return;
    }

    const arc = await arcService.findByAgentToken(agentToken);
    if (!arc) {
      socket.close(4001, "Invalid agent token");
      return;
    }

    const conn: AgentConnection = { ws: socket, arcId: arc.id, userId: arc.user.id };
    agents.set(arc.id, conn);
    agentService.registerAgent(arc.id, arc.user.id, socket);

    await arcService.updateStatus(arc.id, "ONLINE");
    broadcastToClients("arc:status", { arcId: arc.id, status: "ONLINE" });
    logger.info({ arcId: arc.id }, "Agent connected");

    socket.on("message", async (raw) => {
      try {
        const msg: WsMessage = JSON.parse(raw.toString());
        await handleAgentMessage(conn, msg, arcService, agentService);
      } catch (err) {
        logger.error(err, "Agent message error");
      }
    });

    socket.on("close", async () => {
      agents.delete(arc.id);
      agentService.unregisterAgent(arc.id);
      await arcService.updateStatus(arc.id, "OFFLINE");
      broadcastToClients("arc:status", { arcId: arc.id, status: "OFFLINE" });
      logger.info({ arcId: arc.id }, "Agent disconnected");
    });
  });
}

async function handleClientMessage(
  conn: ClientConnection,
  msg: WsMessage,
  arcService: ArcService,
  agentService: AgentService,
  orchestrator: LlmOrchestrator,
) {
  switch (msg.type) {
    case "chat:send": {
      const arcId = msg.arcId as string;
      const content = msg.content as string;
      const mode = (msg.mode as string) || "default";
      if (!arcId || !content) return;

      const arc = await arcService.getById(arcId, conn.userId);
      if (!arc) {
        sendToClient(conn.ws, "error", { code: "NOT_FOUND", message: "Arc not found" });
        return;
      }

      await arcService.createMessage(arcId, "USER", content);

      const history = await arcService.getHistoryForLlm(arcId);

      try {
        const response = await orchestrator.processMessage(arcId, content, agentService, history, mode as any, (event) => {
          switch (event.type) {
            case "thinking":
              sendToClient(conn.ws, "chat:thinking", { arcId });
              break;
            case "stream":
              sendToClient(conn.ws, "chat:stream", { arcId, token: event.content });
              break;
            case "tool_call":
              sendToClient(conn.ws, "chat:tool_call", {
                arcId,
                tool: event.toolName,
                params: event.toolParams,
              });
              break;
            case "tool_result":
              sendToClient(conn.ws, "chat:tool_result", {
                arcId,
                tool: event.toolName,
                result: event.toolResult,
              });
              break;
          }
        });

        const saved = await arcService.createMessage(
          arcId,
          "ARC",
          response.content,
          response.toolName,
          response.toolData,
        );

        sendToClient(conn.ws, "chat:message", {
          arcId,
          id: saved.id,
          role: "ARC",
          content: saved.content,
          toolName: saved.toolName,
          toolData: saved.toolData,
          toolCalls: response.toolCalls,
          createdAt: saved.createdAt.toISOString(),
        });
      } catch (err) {
        logger.error(err, "Error processing chat message");
        const errMsg = err instanceof Error ? err.message : "Failed to process message";
        sendToClient(conn.ws, "chat:error", {
          arcId,
          code: "PROCESSING_ERROR",
          message: errMsg,
        });
      }
      break;
    }
    case "metrics:subscribe": {
      const arcId = msg.arcId as string;
      if (arcId) conn.subscribedMetrics.add(arcId);
      break;
    }
    case "metrics:unsubscribe": {
      const arcId = msg.arcId as string;
      if (arcId) conn.subscribedMetrics.delete(arcId);
      break;
    }
  }
}

async function handleAgentMessage(
  conn: AgentConnection,
  msg: WsMessage,
  arcService: ArcService,
  agentService: AgentService,
) {
  switch (msg.type) {
    case "tool:result": {
      agentService.handleToolResult(msg as any);
      break;
    }
    case "agent:metrics": {
      sendToMetricsSubscribers(conn.arcId, msg as Record<string, unknown>);
      break;
    }
    case "agent:heartbeat": {
      await arcService.updateLastSeen(conn.arcId);
      break;
    }
  }
}
