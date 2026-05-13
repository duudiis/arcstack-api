import type { FastifyRequest, FastifyReply } from "fastify";
import { AuthService } from "../services/auth.service.js";
import { AppError } from "../utils/errors.js";

export function createAuthMiddleware(authService: AuthService) {
  return async function authenticate(request: FastifyRequest, reply: FastifyReply) {
    const token = request.cookies.access_token;
    if (!token) {
      throw new AppError(401, "Authentication required", "UNAUTHORIZED");
    }

    try {
      const payload = await authService.verifyAccessToken(token);
      (request as any).userId = payload.sub;
    } catch {
      throw new AppError(401, "Invalid or expired token", "TOKEN_EXPIRED");
    }
  };
}
