import { PrismaClient } from "@prisma/client";
import type { LlmMessage } from "../llm/providers/base.js";
import type { BaseProvider } from "../llm/providers/base.js";
import { logger } from "../utils/logger.js";

export class ConversationService {
  constructor(
    private prisma: PrismaClient,
    private llmProvider?: BaseProvider,
  ) {}

  async create(userId: string, arcId: string, name?: string) {
    return this.prisma.conversation.create({
      data: { userId, arcId, name: name ?? "New Chat" },
      include: { arc: { select: { id: true, name: true, status: true } } },
    });
  }

  async listByUser(userId: string) {
    return this.prisma.conversation.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      include: {
        arc: { select: { id: true, name: true, status: true } },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { content: true, role: true, createdAt: true },
        },
      },
    });
  }

  async getById(id: string, userId: string) {
    return this.prisma.conversation.findFirst({
      where: { id, userId },
      include: { arc: { select: { id: true, name: true, status: true } } },
    });
  }

  async rename(id: string, userId: string, name: string) {
    const conv = await this.prisma.conversation.findFirst({ where: { id, userId } });
    if (!conv) return null;
    return this.prisma.conversation.update({
      where: { id },
      data: { name },
    });
  }

  async delete(id: string, userId: string) {
    const conv = await this.prisma.conversation.findFirst({ where: { id, userId } });
    if (!conv) return { count: 0 };
    await this.prisma.conversation.delete({ where: { id } });
    return { count: 1 };
  }

  async getMessages(conversationId: string, cursor?: string, limit = 50) {
    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = messages.length > limit;
    if (hasMore) messages.pop();

    return {
      messages: messages.reverse(),
      nextCursor: hasMore ? messages[0]?.id : null,
    };
  }

  async createMessage(
    conversationId: string,
    arcId: string,
    role: "USER" | "ARC" | "SYSTEM",
    content: string,
    toolName?: string,
    toolData?: unknown,
  ) {
    const msg = await this.prisma.message.create({
      data: {
        conversationId,
        arcId,
        role,
        content,
        toolName,
        toolData: toolData ? (toolData as any) : undefined,
      },
    });

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    return msg;
  }

  async getHistoryForLlm(conversationId: string, limit = 50): Promise<LlmMessage[]> {
    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
      take: limit,
    });

    const llmMessages: LlmMessage[] = [];

    for (const msg of messages) {
      if (msg.role === "USER") {
        llmMessages.push({ role: "user", content: msg.content });
      } else if (msg.role === "ARC") {
        const toolData = msg.toolData as any;
        if (toolData?.calls && Array.isArray(toolData.calls)) {
          for (const call of toolData.calls) {
            const fakeId = `hist_${msg.id}_${call.tool}`;
            llmMessages.push({
              role: "assistant",
              content: null,
              toolCalls: [{ id: fakeId, tool: call.tool, params: call.params }],
            });
            llmMessages.push({
              role: "tool",
              content: call.result?.success ? call.result.output : `Error: ${call.result?.error ?? "Unknown"}`,
              toolCallId: fakeId,
            });
          }
          llmMessages.push({ role: "assistant", content: msg.content });
        } else {
          llmMessages.push({ role: "assistant", content: msg.content });
        }
      }
    }

    return llmMessages;
  }

  async autoNameConversation(conversationId: string, userMessage: string, arcResponse: string): Promise<string | null> {
    if (!this.llmProvider) return null;

    try {
      const conv = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
      if (!conv || conv.name !== "New Chat") return null;

      const response = await this.llmProvider.chat([
        {
          role: "system",
          content: "Generate a very short conversation title (2-5 words, no quotes, no punctuation at the end). Based on what the user asked about.",
        },
        { role: "user", content: userMessage },
        { role: "assistant", content: arcResponse.slice(0, 200) },
        { role: "user", content: "What should this conversation be titled?" },
      ]);

      const name = (response.content ?? "").trim().slice(0, 64);
      if (name) {
        await this.prisma.conversation.update({
          where: { id: conversationId },
          data: { name },
        });
        return name;
      }
    } catch (err) {
      logger.error({ conversationId, err }, "Failed to auto-name conversation");
    }
    return null;
  }
}
