import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";
import { SignJWT, jwtVerify } from "jose";
import { config } from "../config.js";
import { generateToken, hashToken } from "../utils/crypto.js";
import type { JwtPayload } from "../types/index.js";

const accessSecret = new TextEncoder().encode(config.JWT_SECRET);
const refreshSecret = new TextEncoder().encode(config.JWT_REFRESH_SECRET);

export class AuthService {
  constructor(private prisma: PrismaClient) {}

  async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  async verifyPassword(hash: string, password: string): Promise<boolean> {
    return argon2.verify(hash, password);
  }

  async signAccessToken(userId: string): Promise<string> {
    return new SignJWT({ sub: userId })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(accessSecret);
  }

  async signRefreshToken(userId: string, userAgent?: string): Promise<string> {
    const raw = generateToken();
    const hashed = hashToken(raw);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.prisma.session.create({
      data: { userId, refreshToken: hashed, userAgent, expiresAt },
    });

    return raw;
  }

  async verifyAccessToken(token: string): Promise<JwtPayload> {
    const { payload } = await jwtVerify(token, accessSecret);
    return payload as unknown as JwtPayload;
  }

  async rotateRefreshToken(
    oldRaw: string,
    userAgent?: string,
  ): Promise<{ accessToken: string; refreshToken: string; userId: string } | null> {
    const hashed = hashToken(oldRaw);
    const session = await this.prisma.session.findUnique({ where: { refreshToken: hashed } });

    if (!session || session.expiresAt < new Date()) {
      if (session) await this.prisma.session.delete({ where: { id: session.id } });
      return null;
    }

    await this.prisma.session.delete({ where: { id: session.id } });

    const [accessToken, refreshToken] = await Promise.all([
      this.signAccessToken(session.userId),
      this.signRefreshToken(session.userId, userAgent),
    ]);

    return { accessToken, refreshToken, userId: session.userId };
  }

  async revokeUserSessions(userId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { userId } });
  }

  async revokeSession(rawToken: string): Promise<void> {
    const hashed = hashToken(rawToken);
    await this.prisma.session.deleteMany({ where: { refreshToken: hashed } });
  }
}
