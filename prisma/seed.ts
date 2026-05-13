import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";
import { createHash, randomBytes } from "node:crypto";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await argon2.hash("password123", { type: argon2.argon2id });

  const user = await prisma.user.upsert({
    where: { email: "demo@arcstack.dev" },
    update: {},
    create: {
      email: "demo@arcstack.dev",
      username: "demo",
      passwordHash,
    },
  });

  console.log(`Seeded user: ${user.email} (password: password123)`);

  const rawToken = randomBytes(32).toString("hex");
  const hashedToken = createHash("sha256").update(rawToken).digest("hex");

  const arc = await prisma.arc.upsert({
    where: { agentToken: hashedToken },
    update: {},
    create: {
      name: "dev-server",
      userId: user.id,
      agentToken: hashedToken,
    },
  });

  console.log(`Seeded arc: ${arc.name} (token: ${rawToken})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
