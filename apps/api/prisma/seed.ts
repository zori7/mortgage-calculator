import { PrismaClient } from "@prisma/client";
import { ScenarioCreate } from "@mt/shared";
import { toCreateData } from "../src/scenarios/repo.js";

const prisma = new PrismaClient();

const seeds: ScenarioCreate[] = [
  { name: "Starter home — 30y fixed", principal: 320_000, annualRatePct: 6.5, termYears: 30, extraMonthly: 0 },
  { name: "Starter home — 15y fixed", principal: 320_000, annualRatePct: 5.75, termYears: 15, extraMonthly: 0 },
  { name: "30y + $400/mo extra", principal: 320_000, annualRatePct: 6.5, termYears: 30, extraMonthly: 400 },
];

await prisma.scenario.deleteMany();
await prisma.scenario.createMany({ data: seeds.map((s) => toCreateData(ScenarioCreate.parse(s))) });
console.log(`seeded ${seeds.length} scenarios`);
await prisma.$disconnect();
