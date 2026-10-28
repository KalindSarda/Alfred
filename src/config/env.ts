import { z } from "zod";

export interface Bindings {
  DB: D1Database;
  ASSETS: Fetcher;
  AUTH_HMAC_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  SMTP_HOST: string;
  SMTP_PORT: string;
  SMTP_USER: string;
  SMTP_PASSWORD: string;
  SMTP_FROM: string;
  SMTP_FROM_NAME?: string;
  EMAIL_TRANSPORT?: string;
}

const secretsSchema = z.object({
  AUTH_HMAC_KEY: z.string().min(32),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce
    .number()
    .int()
    .refine((p) => p === 465 || p === 587, "SMTP_PORT must be 465 or 587"),
  SMTP_USER: z.string().min(1),
  SMTP_PASSWORD: z.string().min(1),
  SMTP_FROM: z.string().min(1),
  /** The sender name people see in their inbox. */
  SMTP_FROM_NAME: z.string().trim().min(1).max(60).default("Alfred"),
  EMAIL_TRANSPORT: z.enum(["smtp", "console"]).default("smtp"),
});

export type Config = z.infer<typeof secretsSchema>;

let cached: Config | undefined;

/** Validates the Worker's secrets once per isolate; throws a readable list of what is missing or malformed. */
export function getConfig(env: Bindings): Config {
  if (cached) return cached;
  const parsed = secretsSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${problems}`);
  }
  cached = parsed.data;
  return cached;
}
