import type { AmortizationRow, AmortizationSummary, LoanInput } from "./schemas.js";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Standard fixed-rate monthly payment (principal + interest), before extra payments. */
export function monthlyPayment(principal: number, annualRatePct: number, termYears: number): number {
  const n = termYears * 12;
  const r = annualRatePct / 100 / 12;
  if (r === 0) return round2(principal / n);
  return round2((principal * r) / (1 - Math.pow(1 + r, -n)));
}

/**
 * Full month-by-month schedule. `extraMonthly` goes straight to principal, so the
 * loan may finish before `termYears * 12` months.
 */
export function amortize(input: LoanInput): { summary: AmortizationSummary; schedule: AmortizationRow[] } {
  const { principal, annualRatePct, termYears, extraMonthly = 0 } = input;
  const base = monthlyPayment(principal, annualRatePct, termYears);
  const r = annualRatePct / 100 / 12;

  const schedule: AmortizationRow[] = [];
  let balance = principal;
  let totalPaid = 0;
  let totalInterest = 0;

  const lastMonth = termYears * 12;
  for (let month = 1; balance > 0.005 && month <= lastMonth; month++) {
    const interest = round2(balance * r);
    const payoff = round2(balance + interest);
    // Cent rounding leaves a small residual; the final scheduled payment absorbs it.
    const payment = month === lastMonth ? payoff : Math.min(round2(base + extraMonthly), payoff);
    const toPrincipal = round2(payment - interest);
    balance = round2(balance - toPrincipal);

    totalPaid += payment;
    totalInterest += interest;
    schedule.push({ month, payment, principal: toPrincipal, interest, balance: Math.max(balance, 0) });
  }

  return {
    summary: {
      monthlyPayment: base,
      months: schedule.length,
      totalPaid: round2(totalPaid),
      totalInterest: round2(totalInterest),
    },
    schedule,
  };
}
