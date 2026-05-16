import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string(),
  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  OPENAI_API_KEY: z.string().startsWith("sk-"),
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default("0.0.0.0"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  FRONTEND_URL: z.string().url().default("http://localhost:3000"),
  COOKIE_DOMAIN: z.string().default("localhost"),

  // Google OAuth
  GOOGLE_CLIENT_ID: z.string().default(""),

  // AWS EC2 compute provisioning
  AWS_REGION: z.string().default("us-east-1"),
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  AWS_AMI_ID: z.string().startsWith("ami-"),
  AWS_SECURITY_GROUP_ID: z.string().startsWith("sg-"),
  AWS_SUBNET_ID: z.string().startsWith("subnet-"),
  AWS_KEY_PAIR_NAME: z.string().min(1),
  AWS_INSTANCE_TYPE: z.string().default("t2.micro"),

  // Public URL the agent connects back to (wss://api.dudis.space or ws://localhost:4000)
  AGENT_WS_URL: z.string().default("ws://localhost:4000"),
  // Git repo URL for the agent (cloned on each instance)
  AGENT_REPO_URL: z.string().default("https://github.com/duudiis/arcstack-agent.git"),
});

export type Env = z.infer<typeof envSchema>;

function loadConfig(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}

export const config = loadConfig();
