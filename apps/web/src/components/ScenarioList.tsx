import type { ScenarioWithSummary } from "@mt/shared";
import { duration, money } from "../format.js";

interface Props {
  scenarios: ScenarioWithSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

export function ScenarioList({ scenarios, selectedId, onSelect, onDelete }: Props) {
  return (
    <section className="card">
      <h2>Saved scenarios</h2>
      {scenarios.length === 0 && <p className="muted">Nothing saved yet.</p>}
      <ul className="list">
        {scenarios.map((s) => (
          <li key={s.id} className={s.id === selectedId ? "selected" : undefined}>
            <button className="link" onClick={() => onSelect(s.id)}>
              <strong>{s.name}</strong>
              <span className="muted">
                {money(s.principal)} · {s.annualRatePct}% · {s.termYears}y
                {s.extraMonthly > 0 && ` · +${money(s.extraMonthly)}/mo`}
              </span>
              <span>
                {money(s.summary.monthlyPayment + s.extraMonthly)}/mo · {duration(s.summary.months)} · interest{" "}
                {money(s.summary.totalInterest)}
              </span>
            </button>
            <button className="danger" aria-label={`Delete ${s.name}`} onClick={() => onDelete(s.id)}>
              ✕
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
