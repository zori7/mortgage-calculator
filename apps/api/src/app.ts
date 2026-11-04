import Fastify, { type FastifyServerOptions } from "fastify";
import cors from "@fastify/cors";
import { PrismaClient } from "@prisma/client";
import { Redis } from "ioredis";
import { ZodError, z } from "zod";
import { scenarioRoutes } from "./scenarios/routes.js";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
    redis: Redis;
  }
}

export interface AppDeps {
  prisma: PrismaClient;
  redis: Redis;
}

export async function buildApp(deps: AppDeps, opts: FastifyServerOptions = {}) {
  const app = Fastify(opts);

  app.decorate("prisma", deps.prisma);
  app.decorate("redis", deps.redis);

  await app.register(cors, { origin: true });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: "validation_error", issues: z.flattenError(err).fieldErrors });
    }
    app.log.error(err);
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    return reply.code(status).send({ error: status === 500 ? "internal_error" : (err as Error).message });
  });

  app.get("/health", async () => {
    const [db, redis] = await Promise.allSettled([deps.prisma.$queryRaw`SELECT 1`, deps.redis.ping()]);
    return { ok: true, db: db.status === "fulfilled", redis: redis.status === "fulfilled" };
  });

  await app.register(scenarioRoutes);

  return app;
}
