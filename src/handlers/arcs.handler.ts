import type { FastifyRequest, FastifyReply } from "fastify";
import { ArcService } from "../services/arc.service.js";
import { AppError } from "../utils/errors.js";
import type { CreateArcInput, ArcParams, MessagesQuery } from "../schemas/arcs.schema.js";

const MAX_ARCS_PER_USER = 1;

export class ArcsHandler {
  constructor(private arcService: ArcService) {}

  list = async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).userId as string;
    const arcs = await this.arcService.listByUser(userId);
    reply.send({ arcs });
  };

  create = async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).userId as string;
    const { name } = request.body as CreateArcInput;

    // Enforce 1 arc per user on free plan
    const existing = await this.arcService.listByUser(userId);
    if (existing.length >= MAX_ARCS_PER_USER) {
      throw new AppError(403, "You've reached the maximum of 1 Arc on the free plan. Upgrade your plan to create more.", "PLAN_LIMIT");
    }

    const { arc, rawToken } = await this.arcService.create(userId, name);

    reply.status(201).send({
      arc: {
        id: arc.id,
        name: arc.name,
        status: arc.status,
        instanceId: arc.instanceId,
        instanceIp: arc.instanceIp,
        instanceState: arc.instanceState,
        lastSeenAt: arc.lastSeenAt,
        createdAt: arc.createdAt,
      },
      agentToken: rawToken,
    });
  };

  get = async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).userId as string;
    const { id } = request.params as ArcParams;

    const arc = await this.arcService.getById(id, userId);
    if (!arc) throw new AppError(404, "Arc not found", "NOT_FOUND");

    reply.send({ arc });
  };

  remove = async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).userId as string;
    const { id } = request.params as ArcParams;

    const result = await this.arcService.delete(id, userId);
    if (result.count === 0) throw new AppError(404, "Arc not found", "NOT_FOUND");

    reply.send({ ok: true });
  };

  messages = async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).userId as string;
    const { id } = request.params as ArcParams;
    const { cursor, limit } = request.query as MessagesQuery;

    const arc = await this.arcService.getById(id, userId);
    if (!arc) throw new AppError(404, "Arc not found", "NOT_FOUND");

    const result = await this.arcService.getMessages(id, cursor, limit);
    reply.send(result);
  };
}
