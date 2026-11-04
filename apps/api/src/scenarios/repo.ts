import type { Prisma, Scenario as ScenarioRow } from "@prisma/client";
import { amortize, type ScenarioCreate, type ScenarioWithSummary } from "@mt/shared";

const toCents = (dollars: number) => Math.round(dollars * 100);
const toDollars = (cents: number) => cents / 100;

/** API shape (dollars) → DB shape (cents). */
export function toCreateData(input: ScenarioCreate): Prisma.ScenarioCreateInput {
  return {
    name: input.name,
    principalCents: toCents(input.principal),
    annualRatePct: input.annualRatePct,
    termYears: input.termYears,
    extraMonthlyCents: toCents(input.extraMonthly),
  };
}

/** DB row (cents) → API shape (dollars), with the amortization summary attached. */
export function toApi(row: ScenarioRow): ScenarioWithSummary {
  const loan = {
    principal: toDollars(row.principalCents),
    annualRatePct: row.annualRatePct,
    termYears: row.termYears,
    extraMonthly: toDollars(row.extraMonthlyCents),
  };
  return {
    id: row.id,
    name: row.name,
    ...loan,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    summary: amortize(loan).summary,
  };
}
