import { AmortizationRow, AmortizationSummary, ScenarioWithSummary, type ScenarioCreate } from "@mt/shared";
import { z } from "zod";

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4001";

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`API ${status}`);
  }
}

async function request<T>(path: string, schema: z.ZodType<T> | null, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: init?.body ? { "content-type": "application/json" } : undefined,
  });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
  if (!schema) return undefined as T;
  return schema.parse(await res.json());
}

const Schedule = z.object({ summary: AmortizationSummary, schedule: z.array(AmortizationRow) });
export type Schedule = z.infer<typeof Schedule>;

export const api = {
  list: () => request("/scenarios", z.array(ScenarioWithSummary)),
  create: (input: ScenarioCreate) =>
    request("/scenarios", ScenarioWithSummary, { method: "POST", body: JSON.stringify(input) }),
  remove: (id: string) => request(`/scenarios/${id}`, null, { method: "DELETE" }),
  schedule: (id: string) => request(`/scenarios/${id}/schedule`, Schedule),
};
