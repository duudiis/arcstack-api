import { PrismaClient, type ArcStatus } from "@prisma/client";
import { generateToken, hashToken } from "../utils/crypto.js";
import { ComputeService } from "./compute.service.js";
import { logger } from "../utils/logger.js";

export class ArcService {
  constructor(
    private prisma: PrismaClient,
    private compute: ComputeService,
  ) {}

  async create(userId: string, name: string) {
    const rawToken = generateToken();
    const hashedToken = hashToken(rawToken);

    const arc = await this.prisma.arc.create({
      data: { name, userId, agentToken: hashedToken },
    });

    // Provision EC2 instance in the background — don't block the API response.
    // The user gets the token immediately; the instance boots and the agent connects once ready.
    this.provisionInBackground(arc.id, name, rawToken).catch((err) => {
      logger.error({ arcId: arc.id, err }, "Background EC2 provisioning failed");
    });

    return { arc, rawToken };
  }

  private async provisionInBackground(arcId: string, arcName: string, agentToken: string) {
    try {
      await this.compute.provisionInstance(arcId, arcName, agentToken);
      logger.info({ arcId }, "EC2 instance provisioned and agent starting");
    } catch (err) {
      logger.error({ arcId, err }, "Failed to provision EC2 instance");
      // Mark the arc as ERROR so the user sees something went wrong
      await this.prisma.arc.update({
        where: { id: arcId },
        data: { status: "ERROR", instanceState: "failed" },
      });
    }
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
    // Look up the arc first so we can terminate its instance
    const arc = await this.prisma.arc.findFirst({ where: { id, userId } });
    if (!arc) return { count: 0 };

    // Terminate the EC2 instance if one exists
    if (arc.instanceId) {
      try {
        await this.compute.terminateInstance(arc.id);
        logger.info({ arcId: id, instanceId: arc.instanceId }, "EC2 instance terminated on arc deletion");
      } catch (err) {
        logger.error({ arcId: id, err }, "Failed to terminate EC2 instance during arc deletion");
        // Continue with deletion anyway — orphaned instances can be cleaned up via tags
      }
    }

    await this.prisma.arc.delete({ where: { id } });
    return { count: 1 };
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
