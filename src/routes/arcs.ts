import type { FastifyInstance } from "fastify";
import { ArcsHandler } from "../handlers/arcs.handler.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validate.js";
import { createArcSchema, arcParamsSchema, messagesQuerySchema } from "../schemas/arcs.schema.js";

export function arcsRoutes(app: FastifyInstance, handler: ArcsHandler, authenticate: any) {
  const auth = { preHandler: [authenticate] };

  app.get("/api/v1/arcs", auth, handler.list);
  app.post(
    "/api/v1/arcs",
    { preHandler: [authenticate, validateBody(createArcSchema)] },
    handler.create,
  );
  app.get(
    "/api/v1/arcs/:id",
    { preHandler: [authenticate, validateParams(arcParamsSchema)] },
    handler.get,
  );
  app.delete(
    "/api/v1/arcs/:id",
    { preHandler: [authenticate, validateParams(arcParamsSchema)] },
    handler.remove,
  );
  app.get(
    "/api/v1/arcs/:id/messages",
    { preHandler: [authenticate, validateParams(arcParamsSchema), validateQuery(messagesQuerySchema)] },
    handler.messages,
  );
}
