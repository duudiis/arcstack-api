import type { FastifyRequest, FastifyReply } from "fastify";
import type { ZodSchema } from "zod";
import { AppError } from "../utils/errors.js";

export function validateBody(schema: ZodSchema) {
  return async function (request: FastifyRequest, _reply: FastifyReply) {
    const result = schema.safeParse(request.body);
    if (!result.success) {
      const message = result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ");
      throw new AppError(400, message, "VALIDATION_ERROR");
    }
    request.body = result.data;
  };
}

export function validateQuery(schema: ZodSchema) {
  return async function (request: FastifyRequest, _reply: FastifyReply) {
    const result = schema.safeParse(request.query);
    if (!result.success) {
      const message = result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ");
      throw new AppError(400, message, "VALIDATION_ERROR");
    }
    request.query = result.data as any;
  };
}

export function validateParams(schema: ZodSchema) {
  return async function (request: FastifyRequest, _reply: FastifyReply) {
    const result = schema.safeParse(request.params);
    if (!result.success) {
      const message = result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ");
      throw new AppError(400, message, "VALIDATION_ERROR");
    }
    request.params = result.data as any;
  };
}
