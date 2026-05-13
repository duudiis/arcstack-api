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

export interface ClientToServerEvents {
  "chat:send": (data: { arcId: string; content: string }) => void;
  "metrics:subscribe": (data: { arcId: string }) => void;
  "metrics:unsubscribe": (data: { arcId: string }) => void;
}

export interface ServerToClientEvents {
  "chat:message": (data: MessageResponse) => void;
  "chat:stream": (data: { arcId: string; chunk: string; done: boolean }) => void;
  "arc:status": (data: { arcId: string; status: ArcStatus }) => void;
  "metrics:update": (data: { arcId: string } & MetricsPayload) => void;
  error: (data: { code: string; message: string }) => void;
}

export interface AgentToServerEvents {
  "agent:register": (data: { arcId: string; capabilities: string[] }) => void;
  "tool:result": (data: ToolResultPayload) => void;
  "agent:metrics": (data: { arcId: string } & MetricsPayload) => void;
  "agent:heartbeat": () => void;
}

export interface ServerToAgentEvents {
  "tool:execute": (data: ToolExecutePayload) => void;
  "agent:disconnect": (data: { reason: string }) => void;
}
