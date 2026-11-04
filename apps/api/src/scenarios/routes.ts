import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { amortize, ScenarioCreate } from "@mt/shared";
import { toApi, toCreateData } from "./repo.js";

const IdParams = z.object({ id: z.string().min(1) });
const SCHEDULE_TTL_SECONDS = 300;

export async function scenarioRoutes(app: FastifyInstance) {
  const { prisma, redis } = app;

  app.get("/scenarios", async () => {
    const rows = await prisma.scenario.findMany({ orderBy: { createdAt: "desc" } });
    return rows.map(toApi);
  });

  app.post("/scenarios", async (req, reply) => {
    const input = ScenarioCreate.parse(req.body);
    const row = await prisma.scenario.create({ data: toCreateData(input) });
    return reply.code(201).send(toApi(row));
  });

  app.get("/scenarios/:id", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const row = await prisma.scenario.findUnique({ where: { id } });
    if (!row) return reply.code(404).send({ error: "not_found" });
    return toApi(row);
  });

  app.delete("/scenarios/:id", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const { count } = await prisma.scenario.deleteMany({ where: { id } });
    if (count === 0) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });

  /**
   * Full month-by-month schedule. Cached in Redis; the key includes updatedAt so
   * any future edit endpoint invalidates it automatically.
   */
  app.get("/scenarios/:id/schedule", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const row = await prisma.scenario.findUnique({ where: { id } });
    if (!row) return reply.code(404).send({ error: "not_found" });

    const key = `schedule:${id}:${row.updatedAt.getTime()}`;
    const cached = await redis.get(key);
    if (cached) {
      return reply.header("x-cache", "HIT").type("application/json").send(cached);
    }

    const scenario = toApi(row);
    const body = JSON.stringify(amortize(scenario));
    await redis.set(key, body, "EX", SCHEDULE_TTL_SECONDS);
    return reply.header("x-cache", "MISS").type("application/json").send(body);
  });
}
