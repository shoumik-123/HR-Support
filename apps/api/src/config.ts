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
  isProduction: process.env.NODE_ENV === "production",
  runWorker: process.env.RUN_WORKER !== "false",
};
