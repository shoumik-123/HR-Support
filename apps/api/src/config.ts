import path from "node:path";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

const jwtSecret = required("JWT_SECRET");
if (jwtSecret === "change-me" || jwtSecret.length < 32) {
  throw new Error("JWT_SECRET must be a random string of at least 32 characters");
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required("DATABASE_URL"),
  jwtSecret,
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL ?? "15m",
  refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30),
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  storageDir: path.resolve(process.env.STORAGE_DIR ?? "./storage"),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB ?? 10) * 1024 * 1024,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
  aiModel: process.env.AI_MODEL ?? "claude-opus-5-5",
  smtpUrl: process.env.SMTP_URL || undefined,
  mailFrom: process.env.MAIL_FROM ?? "Veyra Talent <no-reply@veyra.local>",
  // WhatsApp (Meta Cloud API). Platform-wide rather than per organization: these are bearer
  // credentials and nothing here encrypts data at rest yet. Absent, WhatsApp still works —
  // every message is recorded with exactly what would have been sent, as email does without SMTP.
  whatsappToken: process.env.WHATSAPP_TOKEN || undefined,
  whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || undefined,
  whatsappBusinessNumber: process.env.WHATSAPP_BUSINESS_NUMBER || undefined,
  whatsappApiVersion: process.env.WHATSAPP_API_VERSION ?? "v21.0",
  whatsappAppSecret: process.env.WHATSAPP_APP_SECRET || undefined,
  whatsappVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN || undefined,
  isProduction: process.env.NODE_ENV === "production",
  runWorker: process.env.RUN_WORKER !== "false",
};
