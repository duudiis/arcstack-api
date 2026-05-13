import type { FastifyInstance } from "fastify";
import { AuthHandler } from "../handlers/auth.handler.js";
import { validateBody } from "../middleware/validate.js";
import { registerSchema, loginSchema } from "../schemas/auth.schema.js";

export function authRoutes(app: FastifyInstance, handler: AuthHandler, authenticate: any) {
  app.post("/api/v1/auth/register", { preHandler: [validateBody(registerSchema)] }, handler.register);
  app.post("/api/v1/auth/login", { preHandler: [validateBody(loginSchema)] }, handler.login);
  app.post("/api/v1/auth/logout", { preHandler: [authenticate] }, handler.logout);
  app.post("/api/v1/auth/refresh", handler.refresh);
  app.get("/api/v1/auth/me", { preHandler: [authenticate] }, handler.me);
}
