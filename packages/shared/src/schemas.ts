import { z } from "zod";

/**
 * Loan inputs. Money is in dollars in the API and UI; the DB stores cents
 * (see apps/api/src/scenarios/repo.ts).
 */
export const LoanInput = z.object({
  principal: z.number().positive().max(100_000_000),
  annualRatePct: z.number().min(0).max(30),
  termYears: z.number().int().min(1).max(50),
  extraMonthly: z.number().min(0).max(1_000_000).default(0),
});
export type LoanInput = z.infer<typeof LoanInput>;

export const ScenarioCreate = LoanInput.extend({
  name: z.string().trim().min(1).max(100),
});
export type ScenarioCreate = z.infer<typeof ScenarioCreate>;

export const Scenario = ScenarioCreate.extend({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Scenario = z.infer<typeof Scenario>;

export const AmortizationRow = z.object({
  month: z.number().int(),
  payment: z.number(),
  principal: z.number(),
  interest: z.number(),
  balance: z.number(),
});
export type AmortizationRow = z.infer<typeof AmortizationRow>;

export const AmortizationSummary = z.object({
  monthlyPayment: z.number(),
  months: z.number().int(),
  totalPaid: z.number(),
  totalInterest: z.number(),
});
export type AmortizationSummary = z.infer<typeof AmortizationSummary>;

export const ScenarioWithSummary = Scenario.extend({
  summary: AmortizationSummary,
});
export type ScenarioWithSummary = z.infer<typeof ScenarioWithSummary>;
