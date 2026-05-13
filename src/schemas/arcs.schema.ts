import { z } from "zod";

export const createArcSchema = z.object({
  name: z.string().min(1).max(64).trim(),
});

export const arcParamsSchema = z.object({
  id: z.string().cuid(),
});

export const messagesQuerySchema = z.object({
  cursor: z.string().cuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type CreateArcInput = z.infer<typeof createArcSchema>;
export type ArcParams = z.infer<typeof arcParamsSchema>;
export type MessagesQuery = z.infer<typeof messagesQuerySchema>;
