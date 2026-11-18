import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { mkdir } from "node:fs/promises";
import { AppModule } from "./app.module";
import { config } from "./config";

async function bootstrap() {
  await mkdir(config.storageDir, { recursive: true });

  // rawBody keeps the exact bytes of each request alongside the parsed body. The WhatsApp
  // webhook needs them: Meta signs the bytes it sent, and re-serialising the parsed JSON
  // would change key order or spacing and break the signature.
  const app = await NestFactory.create(AppModule, { bodyParser: true, rawBody: true });
  app.setGlobalPrefix("api");
  app.use(helmet({ crossOriginResourcePolicy: { policy: "same-site" } }));
  app.use(cookieParser());
  app.enableCors({
    origin: config.webOrigin.split(",").map((o) => o.trim()),
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "X-Org-Id"],
  });
  app.enableShutdownHooks();
  // Behind a reverse proxy, req.ip reflects X-Forwarded-For.
  app.getHttpAdapter().getInstance().set("trust proxy", 1);

  await app.listen(config.port);
  new Logger("Bootstrap").log(`Veyra Talent API listening on http://localhost:${config.port}/api`);
}

void bootstrap();
