import type { FastifyRequest, FastifyReply } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { AuthService } from "../services/auth.service.js";
import { AppError } from "../utils/errors.js";
import type { RegisterInput, LoginInput } from "../schemas/auth.schema.js";
import { config } from "../config.js";

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: config.NODE_ENV === "production",
  sameSite: "lax" as const,
  domain: config.COOKIE_DOMAIN,
  path: "/",
};

export class AuthHandler {
  constructor(
    private prisma: PrismaClient,
    private authService: AuthService,
  ) {}

  register = async (request: FastifyRequest, reply: FastifyReply) => {
    const { email, username, password } = request.body as RegisterInput;

    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
    });

    if (existing) {
      const field = existing.email === email ? "Email" : "Username";
      throw new AppError(409, `${field} already exists`, "CONFLICT");
    }

    const passwordHash = await this.authService.hashPassword(password);
    const user = await this.prisma.user.create({
      data: { email, username, passwordHash },
    });

    const [accessToken, refreshToken] = await Promise.all([
      this.authService.signAccessToken(user.id),
      this.authService.signRefreshToken(user.id, request.headers["user-agent"]),
    ]);

    reply
      .setCookie("access_token", accessToken, { ...COOKIE_OPTIONS, maxAge: 15 * 60 })
      .setCookie("refresh_token", refreshToken, { ...COOKIE_OPTIONS, maxAge: 7 * 24 * 60 * 60 })
      .status(201)
      .send({
        user: { id: user.id, email: user.email, username: user.username, createdAt: user.createdAt },
      });
  };

  login = async (request: FastifyRequest, reply: FastifyReply) => {
    const { email, password } = request.body as LoginInput;

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !(await this.authService.verifyPassword(user.passwordHash, password))) {
      throw new AppError(401, "Invalid email or password", "INVALID_CREDENTIALS");
    }

    const [accessToken, refreshToken] = await Promise.all([
      this.authService.signAccessToken(user.id),
      this.authService.signRefreshToken(user.id, request.headers["user-agent"]),
    ]);

    reply
      .setCookie("access_token", accessToken, { ...COOKIE_OPTIONS, maxAge: 15 * 60 })
      .setCookie("refresh_token", refreshToken, { ...COOKIE_OPTIONS, maxAge: 7 * 24 * 60 * 60 })
      .send({
        user: { id: user.id, email: user.email, username: user.username, createdAt: user.createdAt },
      });
  };

  logout = async (request: FastifyRequest, reply: FastifyReply) => {
    const refreshToken = request.cookies.refresh_token;
    if (refreshToken) {
      await this.authService.revokeSession(refreshToken);
    }

    reply
      .clearCookie("access_token", COOKIE_OPTIONS)
      .clearCookie("refresh_token", COOKIE_OPTIONS)
      .send({ ok: true });
  };

  refresh = async (request: FastifyRequest, reply: FastifyReply) => {
    const rawToken = request.cookies.refresh_token;
    if (!rawToken) {
      throw new AppError(401, "No refresh token", "UNAUTHORIZED");
    }

    const result = await this.authService.rotateRefreshToken(rawToken, request.headers["user-agent"]);
    if (!result) {
      reply.clearCookie("access_token", COOKIE_OPTIONS).clearCookie("refresh_token", COOKIE_OPTIONS);
      throw new AppError(401, "Invalid or expired refresh token", "TOKEN_EXPIRED");
    }

    reply
      .setCookie("access_token", result.accessToken, { ...COOKIE_OPTIONS, maxAge: 15 * 60 })
      .setCookie("refresh_token", result.refreshToken, { ...COOKIE_OPTIONS, maxAge: 7 * 24 * 60 * 60 })
      .send({ ok: true });
  };

  me = async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).userId as string;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, username: true, createdAt: true },
    });

    if (!user) throw new AppError(404, "User not found", "NOT_FOUND");
    reply.send({ user });
  };
}
