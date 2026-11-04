# Tasks

Ten small, independent tasks for testing parallel agents. Each one should take an
agent 5–20 minutes and is checked with `pnpm check` plus the acceptance criteria.

**Layers** shows what each task touches, so you can predict merge conflicts when
several run at once. Tasks marked 🗄 add a Prisma migration. Running two of
those in parallel is a good test of how agents (and you) handle conflicting
migrations at merge time.

| #  | Task                         | Layers               | Migration |
|----|------------------------------|----------------------|-----------|
| 1  | Notes field                  | db · api · web       | 🗄        |
| 2  | Edit a scenario              | api · web            |           |
| 3  | Yearly schedule view         | web                  |           |
| 4  | Full monthly cost (PITI)     | shared · web         |           |
| 5  | CSV export                   | api · web            |           |
| 6  | Sort the scenario list       | api · web            |           |
| 7  | Duplicate a scenario         | api · web            |           |
| 8  | Rate-limit writes with Redis | api                  |           |
| 9  | Inline form validation       | web                  |           |
| 10 | Down payment & home price    | shared · db · api · web | 🗄     |

Good parallel batches: **{3, 5, 8}** (no overlap), **{2, 6, 7}** (all touch
`routes.ts` and `ScenarioList.tsx`, so expect conflicts), **{1, 10}** (two
migrations).

---

## 1. Notes field 🗄

Let users attach free-text notes to a scenario.

- Add an optional `notes` column (max 500 chars) to `Scenario` with a Prisma migration.
- Add `notes` to the zod schemas in `packages/shared` (optional, trimmed, ≤ 500).
- Add a textarea to the calculator form. Show notes (truncated to ~80 chars) in the saved list.

**Done when:** a scenario saved with notes shows them after a page reload, a
501-char note is rejected with a 400, and there is an API test for both.

## 2. Edit a scenario

- Add `PUT /scenarios/:id`, which takes the same body as POST and returns 404 for an unknown id.
- In the UI, clicking "Edit" on a saved scenario loads it into the calculator. The button then reads "Update scenario" and there is a "Cancel" link.
- The Redis schedule cache must not serve stale data after an edit. The key already includes `updatedAt`, so verify this with a test rather than assuming it.

**Done when:** API tests cover a successful update, a 404 and a 400, and one test shows `/schedule` changes after an update.

## 3. Yearly schedule view

The monthly table is long. Add a "Monthly / Yearly" toggle to `ScheduleTable`.

- Yearly mode shows one row per year with total paid, principal and interest for that year, plus the ending balance.
- Put the aggregation in a pure function in `packages/shared` (`summarizeByYear`) with unit tests.

**Done when:** a 30-year loan shows 30 rows, and the yearly principal column adds up to the loan amount (±$1).

## 4. Full monthly cost (PITI)

The payment shown covers principal and interest only. Real budgets also include taxes and insurance.

- Add optional inputs to the calculator: property tax (% of loan per year), home insurance ($/year), and HOA ($/month). These are UI-only for now and are not persisted.
- Show a breakdown: P&I, tax, insurance, HOA, and a **Total monthly** line.
- Put the math in `packages/shared` (`monthlyCost(...)`) with unit tests.

**Done when:** 300k at 6% for 30 years, with 1.2% tax, $1,200/yr insurance and $0 HOA, shows a total of **$2,198.65**.

## 5. CSV export

- Add `GET /scenarios/:id/schedule.csv`, which returns `text/csv` with a `Content-Disposition: attachment; filename="<slugified-name>.csv"` header.
- Use the columns `month,payment,principal,interest,balance` with 2-decimal numbers.
- Add a "Download CSV" button to `ScheduleTable`.

**Done when:** an API test checks the headers, the header row, and the row count (360 + 1 for a 30-year loan).

## 6. Sort the scenario list

- `GET /scenarios` accepts `?sort=createdAt|monthlyPayment|totalInterest&order=asc|desc`. Validate it with zod (invalid → 400) and default to `createdAt desc`.
- `monthlyPayment` and `totalInterest` are computed rather than stored, so sort those in memory after loading.
- Add a sort dropdown above the saved list.

**Done when:** API tests cover each sort key and the invalid case.

## 7. Duplicate a scenario

- Add `POST /scenarios/:id/duplicate`, which creates a copy named `"<name> (copy)"` and returns 201 with the new scenario.
- Add a "Duplicate" button to each list item. The new item appears at the top.

**Done when:** an API test checks the copy has a new id, the "(copy)" name and identical loan fields, and that duplicating an unknown id returns 404.

## 8. Rate-limit writes with Redis

- Limit `POST`, `PUT` and `DELETE` to 20 requests per minute per IP. Use a Redis fixed-window counter (`INCR` + `EXPIRE`), not an in-memory map, so it would work across multiple API instances.
- Over the limit, return 429 with `{ "error": "rate_limited" }` and a `Retry-After` header.
- Make the limit configurable with the env var `WRITE_RATE_LIMIT` (default 20). Tests can set it low.

**Done when:** a test sends limit+1 POSTs and gets a 429 on the last one, and GETs are never limited.

## 9. Inline form validation

Right now validation errors appear as one joined string under the form.

- Show each zod error under its own field, for example "Loan amount must be greater than 0".
- Disable the Save button while the form is invalid, and add a red border to invalid inputs.
- Show friendly messages instead of raw zod text. Put the mapping in one place.

**Done when:** clearing the name, setting the rate to 40, or setting a negative loan amount each shows a message under the right field, and the button is disabled.

## 10. Down payment & home price 🗄

Users think in terms of home price and down payment, not loan amount.

- Replace the "Loan amount" input with "Home price" and "Down payment". The down payment can be entered in $ or %, with a toggle.
- Compute the loan amount as price − down. Show it read-only and keep `principal` as the stored loan amount.
- Persist `homePriceCents` and `downPaymentCents` (migration). Older rows without them should still display.
- If the down payment is below 20%, show a "PMI likely" hint.

**Done when:** a scenario with a $400k price and 10% down saves a $360k principal, shows the PMI hint, and reloads with its price and down payment intact.
