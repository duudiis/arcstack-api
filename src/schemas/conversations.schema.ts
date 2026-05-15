import { z } from "zod";

export const createConversationSchema = z.object({
  arcId: z.string().cuid(),
  name: z.string().min(1).max(64).trim().optional(),
});

export const renameConversationSchema = z.object({
  name: z.string().min(1).max(64).trim(),
});

export const conversationParamsSchema = z.object({
  id: z.string().cuid(),
});

export const conversationMessagesQuerySchema = z.object({
  cursor: z.string().cuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type CreateConversationInput = z.infer<typeof createConversationSchema>;
export type RenameConversationInput = z.infer<typeof renameConversationSchema>;
export type ConversationParams = z.infer<typeof conversationParamsSchema>;
export type ConversationMessagesQuery = z.infer<typeof conversationMessagesQuerySchema>;
