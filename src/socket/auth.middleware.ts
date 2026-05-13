import type { Socket } from "socket.io";
import { AuthService } from "../services/auth.service.js";
import { ArcService } from "../services/arc.service.js";

function parseCookies(header: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const pair of header.split(";")) {
    const [key, ...rest] = pair.split("=");
    if (key) cookies[key.trim()] = rest.join("=").trim();
  }
  return cookies;
}

export function createClientSocketAuth(authService: AuthService) {
  return async (socket: Socket, next: (err?: Error) => void) => {
    try {
      const cookieHeader = socket.handshake.headers.cookie;
      if (!cookieHeader) return next(new Error("Authentication required"));

      const cookies = parseCookies(cookieHeader);
      const token = cookies.access_token;
      if (!token) return next(new Error("Authentication required"));

      const payload = await authService.verifyAccessToken(token);
      (socket as any).userId = payload.sub;
      next();
    } catch {
      next(new Error("Invalid or expired token"));
    }
  };
}

export function createAgentSocketAuth(arcService: ArcService) {
  return async (socket: Socket, next: (err?: Error) => void) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error("Agent token required"));

      const arc = await arcService.findByAgentToken(token);
      if (!arc) return next(new Error("Invalid agent token"));

      (socket as any).arcId = arc.id;
      (socket as any).userId = arc.user.id;
      next();
    } catch {
      next(new Error("Authentication failed"));
    }
  };
}
