import { useMemo, useState } from "react";
import { amortize, LoanInput, ScenarioCreate } from "@mt/shared";
import { api } from "../api.js";
import { duration, money } from "../format.js";

const initial = { name: "", principal: 350_000, annualRatePct: 6.5, termYears: 30, extraMonthly: 0 };

export function Calculator({ onSaved }: { onSaved: () => void }) {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Live preview runs the same shared math the API uses.
  const preview = useMemo(() => {
    const parsed = LoanInput.safeParse(form);
    return parsed.success ? amortize(parsed.data).summary : null;
  }, [form]);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: key === "name" ? e.target.value : Number(e.target.value) }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const parsed = ScenarioCreate.safeParse(form);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      return;
    }
    setSaving(true);
    try {
      await api.create(parsed.data);
      setForm((f) => ({ ...f, name: "" }));
      setError(null);
      onSaved();
    } catch {
      setError("Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="card" onSubmit={save}>
      <h2>Calculator</h2>
      <label>
        Name
        <input value={form.name} onChange={set("name")} placeholder="e.g. 30y fixed @ 6.5%" />
      </label>
      <label>
        Loan amount ($)
        <input type="number" min={0} step={1000} value={form.principal} onChange={set("principal")} />
      </label>
      <div className="row">
        <label>
          Rate (%)
          <input type="number" min={0} step={0.125} value={form.annualRatePct} onChange={set("annualRatePct")} />
        </label>
        <label>
          Term (years)
          <input type="number" min={1} max={50} value={form.termYears} onChange={set("termYears")} />
        </label>
      </div>
      <label>
        Extra monthly payment ($)
        <input type="number" min={0} step={50} value={form.extraMonthly} onChange={set("extraMonthly")} />
      </label>

      {preview ? (
        <dl className="summary">
          <dt>Monthly payment</dt>
          <dd className="big">{money(preview.monthlyPayment + form.extraMonthly)}</dd>
          <dt>Paid off in</dt>
          <dd>{duration(preview.months)}</dd>
          <dt>Total interest</dt>
          <dd>{money(preview.totalInterest)}</dd>
        </dl>
      ) : (
        <p className="muted">Enter valid loan values to see a preview.</p>
      )}

      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={saving}>
        {saving ? "Saving…" : "Save scenario"}
      </button>
    </form>
  );
}
