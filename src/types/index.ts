import type { ArcStatus, MessageRole } from "@prisma/client";

export interface JwtPayload {
  sub: string;
  iat: number;
  exp: number;
}

export interface UserResponse {
  id: string;
  email: string;
  username: string;
  createdAt: string;
}

export interface ArcResponse {
  id: string;
  name: string;
  status: ArcStatus;
  instanceId: string | null;
  instanceIp: string | null;
  instanceState: string | null;
  lastSeenAt: string | null;
  createdAt: string;
}

export interface MessageResponse {
  id: string;
  role: MessageRole;
  content: string;
  toolName: string | null;
  toolData: unknown;
  createdAt: string;
}

export interface MetricsPayload {
  cpu: number;
  ram: { used: number; total: number; percent: number };
  disk: { used: number; total: number; percent: number };
  network: { rxBytes: number; txBytes: number };
  processes: number;
  uptime: number;
}

export interface ToolExecutePayload {
  arcId: string;
  requestId: string;
  tool: string;
  params: Record<string, unknown>;
}

export interface ToolResultPayload {
  arcId: string;
  requestId: string;
  success: boolean;
  output: string;
  error?: string;
  executionTimeMs: number;
}

// WebSocket message types (JSON protocol with `type` field routing)
export type WsMessageType =
  | "chat:send"
  | "chat:message"
  | "chat:stream"
  | "arc:status"
  | "metrics:subscribe"
  | "metrics:unsubscribe"
  | "metrics:update"
  | "tool:execute"
  | "tool:result"
  | "agent:heartbeat"
  | "agent:metrics"
  | "error";
