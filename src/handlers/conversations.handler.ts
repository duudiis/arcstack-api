import type { FastifyRequest, FastifyReply } from "fastify";
import { ConversationService } from "../services/conversation.service.js";
import { ArcService } from "../services/arc.service.js";
import { AppError } from "../utils/errors.js";
import type {
  CreateConversationInput,
  RenameConversationInput,
  ConversationParams,
  ConversationMessagesQuery,
} from "../schemas/conversations.schema.js";

export class ConversationsHandler {
  constructor(
    private conversationService: ConversationService,
    private arcService: ArcService,
  ) {}

  list = async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).userId as string;
    const conversations = await this.conversationService.listByUser(userId);
    reply.send({ conversations });
  };

  create = async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).userId as string;
    const { arcId, name } = request.body as CreateConversationInput;

    const arc = await this.arcService.getById(arcId, userId);
    if (!arc) throw new AppError(404, "Arc not found", "NOT_FOUND");

    const conversation = await this.conversationService.create(userId, arcId, name);
    reply.status(201).send({ conversation });
  };

  get = async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).userId as string;
    const { id } = request.params as ConversationParams;

    const conversation = await this.conversationService.getById(id, userId);
    if (!conversation) throw new AppError(404, "Conversation not found", "NOT_FOUND");

    reply.send({ conversation });
  };

  rename = async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).userId as string;
    const { id } = request.params as ConversationParams;
    const { name } = request.body as RenameConversationInput;

    const conversation = await this.conversationService.rename(id, userId, name);
    if (!conversation) throw new AppError(404, "Conversation not found", "NOT_FOUND");

    reply.send({ conversation });
  };

  remove = async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).userId as string;
    const { id } = request.params as ConversationParams;

    const result = await this.conversationService.delete(id, userId);
    if (result.count === 0) throw new AppError(404, "Conversation not found", "NOT_FOUND");

    reply.send({ ok: true });
  };

  messages = async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).userId as string;
    const { id } = request.params as ConversationParams;
    const { cursor, limit } = request.query as ConversationMessagesQuery;

    const conversation = await this.conversationService.getById(id, userId);
    if (!conversation) throw new AppError(404, "Conversation not found", "NOT_FOUND");

    const result = await this.conversationService.getMessages(id, cursor, limit);
    reply.send(result);
  };
}
