import { PrismaClient } from "@prisma/client";
import { Redis } from "ioredis";
import { buildApp } from "./app.js";
import { loadEnv } from "./env.js";

const env = loadEnv();
const prisma = new PrismaClient();
const redis = new Redis(env.REDIS_URL);

const app = await buildApp({ prisma, redis }, { logger: { level: "info" } });

const shutdown = async () => {
  await app.close();
  await prisma.$disconnect();
  redis.disconnect();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
