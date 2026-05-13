import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";

export function healthRoutes(app: FastifyInstance, prisma: PrismaClient, redis: Redis) {
  app.get("/api/v1/health", async (_request, reply) => {
    let db = "disconnected";
    let cache = "disconnected";

    try {
      await prisma.$queryRaw`SELECT 1`;
      db = "connected";
    } catch {}

    try {
      await redis.ping();
      cache = "connected";
    } catch {}

    reply.send({
      status: "ok",
      uptime: process.uptime(),
      db,
      redis: cache,
    });
  });
}
