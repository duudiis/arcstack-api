import { PrismaClient, type ArcStatus } from "@prisma/client";
import { generateToken, hashToken } from "../utils/crypto.js";

export class ArcService {
  constructor(private prisma: PrismaClient) {}

  async create(userId: string, name: string) {
    const rawToken = generateToken();
    const hashedToken = hashToken(rawToken);

    const arc = await this.prisma.arc.create({
      data: { name, userId, agentToken: hashedToken },
    });

    return { arc, rawToken };
  }

  async listByUser(userId: string) {
    return this.prisma.arc.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  }

  async getById(id: string, userId: string) {
    return this.prisma.arc.findFirst({ where: { id, userId } });
  }

  async delete(id: string, userId: string) {
    return this.prisma.arc.deleteMany({ where: { id, userId } });
  }

  async findByAgentToken(rawToken: string) {
    const hashed = hashToken(rawToken);
    return this.prisma.arc.findUnique({
      where: { agentToken: hashed },
      include: { user: { select: { id: true, username: true } } },
    });
  }

  async updateStatus(id: string, status: ArcStatus) {
    return this.prisma.arc.update({
      where: { id },
      data: { status, lastSeenAt: status === "ONLINE" ? new Date() : undefined },
    });
  }

  async updateLastSeen(id: string) {
    return this.prisma.arc.update({
      where: { id },
      data: { lastSeenAt: new Date() },
    });
  }

  async getMessages(arcId: string, cursor?: string, limit = 50) {
    const messages = await this.prisma.message.findMany({
      where: { arcId },
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
    arcId: string,
    role: "USER" | "ARC" | "SYSTEM",
    content: string,
    toolName?: string,
    toolData?: unknown,
  ) {
    return this.prisma.message.create({
      data: {
        arcId,
        role,
        content,
        toolName,
        toolData: toolData ? (toolData as any) : undefined,
      },
    });
  }
}
