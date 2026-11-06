import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { Redis } from "ioredis";
import { buildApp } from "../src/app.js";

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL!);
let app: Awaited<ReturnType<typeof buildApp>>;

const valid = { name: "Test loan", principal: 300_000, annualRatePct: 6, termYears: 30, extraMonthly: 0 };

beforeAll(async () => {
  app = await buildApp({ prisma, redis });
});

beforeEach(async () => {
  await prisma.scenario.deleteMany();
  await redis.flushdb();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  redis.disconnect();
});

describe("health", () => {
  it("reports db and redis up", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.json()).toEqual({ ok: true, db: true, redis: true });
  });
});

describe("scenarios", () => {
  it("creates, lists, gets and deletes a scenario", async () => {
    const created = await app.inject({ method: "POST", url: "/scenarios", payload: valid });
    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body).toMatchObject({ ...valid, summary: { monthlyPayment: 1798.65, months: 360 } });

    const list = await app.inject({ method: "GET", url: "/scenarios" });
    expect(list.json()).toHaveLength(1);

    const one = await app.inject({ method: "GET", url: `/scenarios/${body.id}` });
    expect(one.json().name).toBe("Test loan");

    const del = await app.inject({ method: "DELETE", url: `/scenarios/${body.id}` });
    expect(del.statusCode).toBe(204);

    const gone = await app.inject({ method: "GET", url: `/scenarios/${body.id}` });
    expect(gone.statusCode).toBe(404);
  });

  it("round-trips cents precisely", async () => {
    const res = await app.inject({ method: "POST", url: "/scenarios", payload: { ...valid, principal: 250_000.55, extraMonthly: 99.99 } });
    expect(res.json()).toMatchObject({ principal: 250_000.55, extraMonthly: 99.99 });
  });

  it("rejects invalid input with field errors", async () => {
    const res = await app.inject({ method: "POST", url: "/scenarios", payload: { ...valid, principal: -5, name: "" } });
    expect(res.statusCode).toBe(400);
    expect(Object.keys(res.json().issues)).toEqual(expect.arrayContaining(["principal", "name"]));
  });

  it("serves the schedule from Redis on the second request", async () => {
    const { id } = (await app.inject({ method: "POST", url: "/scenarios", payload: valid })).json();

    const first = await app.inject({ method: "GET", url: `/scenarios/${id}/schedule` });
    expect(first.headers["x-cache"]).toBe("MISS");
    expect(first.json().schedule).toHaveLength(360);

    const second = await app.inject({ method: "GET", url: `/scenarios/${id}/schedule` });
    expect(second.headers["x-cache"]).toBe("HIT");
    expect(second.json()).toEqual(first.json());
  });
});

describe("cors", () => {
  it("allows a cross-origin DELETE preflight", async () => {
    const res = await app.inject({
      method: "OPTIONS",
      url: "/scenarios/some-id",
      headers: {
        origin: "http://localhost:5183",
        "access-control-request-method": "DELETE",
      },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-methods"]).toContain("DELETE");
  });
});
