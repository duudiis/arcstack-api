import type { FastifyInstance } from "fastify";
import { ConversationsHandler } from "../handlers/conversations.handler.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validate.js";
import {
  createConversationSchema,
  renameConversationSchema,
  conversationParamsSchema,
  conversationMessagesQuerySchema,
} from "../schemas/conversations.schema.js";

export function conversationsRoutes(app: FastifyInstance, handler: ConversationsHandler, authenticate: any) {
  const auth = { preHandler: [authenticate] };

  app.get("/api/v1/conversations", auth, handler.list);
  app.post(
    "/api/v1/conversations",
    { preHandler: [authenticate, validateBody(createConversationSchema)] },
    handler.create,
  );
  app.get(
    "/api/v1/conversations/:id",
    { preHandler: [authenticate, validateParams(conversationParamsSchema)] },
    handler.get,
  );
  app.patch(
    "/api/v1/conversations/:id",
    { preHandler: [authenticate, validateParams(conversationParamsSchema), validateBody(renameConversationSchema)] },
    handler.rename,
  );
  app.delete(
    "/api/v1/conversations/:id",
    { preHandler: [authenticate, validateParams(conversationParamsSchema)] },
    handler.remove,
  );
  app.get(
    "/api/v1/conversations/:id/messages",
    {
      preHandler: [
        authenticate,
        validateParams(conversationParamsSchema),
        validateQuery(conversationMessagesQuerySchema),
      ],
    },
    handler.messages,
  );
}
