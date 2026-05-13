import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import { config } from "./config.js";
import { logger } from "./utils/logger.js";
import { AppError } from "./utils/errors.js";
import { AuthService } from "./services/auth.service.js";
import { ArcService } from "./services/arc.service.js";
import { AgentService } from "./services/agent.service.js";
import { AuthHandler } from "./handlers/auth.handler.js";
import { ArcsHandler } from "./handlers/arcs.handler.js";
import { createAuthMiddleware } from "./middleware/authenticate.js";
import { authRoutes } from "./routes/auth.js";
import { arcsRoutes } from "./routes/arcs.js";
import { healthRoutes } from "./routes/health.js";
import websocket from "@fastify/websocket";
import { setupWebSockets } from "./socket/index.js";
import { AIFactory } from "./llm/factory.js";
import { LlmOrchestrator } from "./llm/orchestrator.js";

async function main() {
  const prisma = new PrismaClient();
  const redis = new Redis(config.REDIS_URL);

  await prisma.$connect();
  logger.info("Database connected");

  redis.on("connect", () => logger.info("Redis connected"));
  redis.on("error", (err) => logger.error(err, "Redis error"));

  const app = Fastify({ logger: false });

  await app.register(cookie);
  await app.register(cors, {
    origin: config.FRONTEND_URL,
    credentials: true,
  });
  await app.register(rateLimit, {
    max: 60,
    timeWindow: "1 minute",
    keyGenerator: (req) => req.ip,
  });

  app.setErrorHandler((error: Error & { validation?: unknown; statusCode?: number }, request, reply) => {
    if (error instanceof AppError) {
      reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message },
      });
      return;
    }

    if (error.validation) {
      reply.status(400).send({
        error: { code: "VALIDATION_ERROR", message: error.message },
      });
      return;
    }

    logger.error(error, "Unhandled error");
    reply.status(500).send({
      error: { code: "INTERNAL", message: "Internal server error" },
    });
  });

  const authService = new AuthService(prisma);
  const arcService = new ArcService(prisma);
  const agentService = new AgentService();

  const llmProvider = AIFactory.create("openai", {
    apiKey: config.OPENAI_API_KEY,
  });
  const orchestrator = new LlmOrchestrator(llmProvider);

  const authenticate = createAuthMiddleware(authService);
  const authHandler = new AuthHandler(prisma, authService);
  const arcsHandler = new ArcsHandler(arcService);

  await app.register(websocket);

  authRoutes(app, authHandler, authenticate);
  arcsRoutes(app, arcsHandler, authenticate);
  healthRoutes(app, prisma, redis);
  await setupWebSockets(app, authService, arcService, agentService, orchestrator);

  await app.listen({ port: config.PORT, host: config.HOST });

  logger.info(`ArcStack API running on http://${config.HOST}:${config.PORT}`);

  const shutdown = async () => {
    logger.info("Shutting down...");
    await app.close();
    await prisma.$disconnect();
    redis.disconnect();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  logger.error(err, "Failed to start server");
  process.exit(1);
});
