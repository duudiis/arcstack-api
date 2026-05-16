import type { FastifyRequest, FastifyReply } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { AuthService } from "../services/auth.service.js";
import { AppError } from "../utils/errors.js";
import type { RegisterInput, LoginInput } from "../schemas/auth.schema.js";
import { config } from "../config.js";
import { createRemoteJWKSet, jwtVerify } from "jose";

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: config.NODE_ENV === "production",
  sameSite: "lax" as const,
  domain: config.COOKIE_DOMAIN,
  path: "/",
};

const MAX_BETA_USERS = 6;

// Google JWKS for verifying ID tokens
const googleJWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export class AuthHandler {
  constructor(
    private prisma: PrismaClient,
    private authService: AuthService,
  ) {}

  register = async (request: FastifyRequest, reply: FastifyReply) => {
    const { email, username, password } = request.body as RegisterInput;

    // Beta limit: max 3 users
    const userCount = await this.prisma.user.count();
    if (userCount >= MAX_BETA_USERS) {
      throw new AppError(403, "Beta is currently full. Only 6 users are allowed during the beta period.", "BETA_LIMIT");
    }

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
        user: { id: user.id, email: user.email, username: user.username, avatarUrl: user.avatarUrl, createdAt: user.createdAt },
      });
  };

  login = async (request: FastifyRequest, reply: FastifyReply) => {
    const { email, password } = request.body as LoginInput;

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash || !(await this.authService.verifyPassword(user.passwordHash, password))) {
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
        user: { id: user.id, email: user.email, username: user.username, avatarUrl: user.avatarUrl, createdAt: user.createdAt },
      });
  };

  google = async (request: FastifyRequest, reply: FastifyReply) => {
    const { credential } = request.body as { credential: string };

    if (!credential) {
      throw new AppError(400, "Missing Google credential", "BAD_REQUEST");
    }

    if (!config.GOOGLE_CLIENT_ID) {
      throw new AppError(500, "Google OAuth not configured", "CONFIG_ERROR");
    }

    // Verify the Google ID token
    let payload: any;
    try {
      const { payload: verified } = await jwtVerify(credential, googleJWKS, {
        issuer: ["https://accounts.google.com", "accounts.google.com"],
        audience: config.GOOGLE_CLIENT_ID,
      });
      payload = verified;
    } catch (err) {
      throw new AppError(401, "Invalid Google token", "INVALID_TOKEN");
    }

    const googleId = payload.sub as string;
    const email = payload.email as string;
    const name = payload.name as string;
    const picture = payload.picture as string | undefined;

    if (!email) {
      throw new AppError(400, "Google account has no email", "BAD_REQUEST");
    }

    // Check if user already exists by googleId or email
    let user = await this.prisma.user.findFirst({
      where: { OR: [{ googleId }, { email }] },
    });

    if (user) {
      // Link Google if not already linked, update avatar
      if (!user.googleId || user.avatarUrl !== picture) {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: {
            googleId: user.googleId || googleId,
            avatarUrl: picture || user.avatarUrl,
          },
        });
      }
    } else {
      // Beta limit: max 3 users
      const userCount = await this.prisma.user.count();
      if (userCount >= MAX_BETA_USERS) {
        throw new AppError(403, "Beta is currently full. Only 6 users are allowed during the beta period.", "BETA_LIMIT");
      }

      // Create new user from Google profile — prefer display name over email
      const username = name ? generateUsernameFromName(name) : generateUsernameFromEmail(email);
      // Ensure username is unique
      let finalUsername = username;
      let attempt = 0;
      while (await this.prisma.user.findUnique({ where: { username: finalUsername } })) {
        attempt++;
        finalUsername = `${username}${attempt}`;
      }

      user = await this.prisma.user.create({
        data: {
          email,
          username: finalUsername,
          googleId,
          avatarUrl: picture,
        },
      });
    }

    const [accessToken, refreshToken] = await Promise.all([
      this.authService.signAccessToken(user.id),
      this.authService.signRefreshToken(user.id, request.headers["user-agent"]),
    ]);

    reply
      .setCookie("access_token", accessToken, { ...COOKIE_OPTIONS, maxAge: 15 * 60 })
      .setCookie("refresh_token", refreshToken, { ...COOKIE_OPTIONS, maxAge: 7 * 24 * 60 * 60 })
      .send({
        user: { id: user.id, email: user.email, username: user.username, avatarUrl: user.avatarUrl, createdAt: user.createdAt },
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
      select: { id: true, email: true, username: true, avatarUrl: true, createdAt: true },
    });

    if (!user) throw new AppError(404, "User not found", "NOT_FOUND");
    reply.send({ user });
  };
}

function generateUsernameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "user";
  return local.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24) || "user";
}

function generateUsernameFromName(name: string): string {
  // Keep alphanumeric, underscore, hyphen, and spaces
  const cleaned = name.replace(/[^a-zA-Z0-9_\-\s]/g, "").slice(0, 24);
  return cleaned || "user";
}
