import { useEffect, useState } from "react";
import type { ScenarioWithSummary } from "@mt/shared";
import { api, type Schedule } from "../api.js";
import { money } from "../format.js";

const PREVIEW_ROWS = 24;

export function ScheduleTable({ scenario }: { scenario: ScenarioWithSummary }) {
  const [data, setData] = useState<Schedule | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setShowAll(false);
    api.schedule(scenario.id).then((d) => !cancelled && setData(d));
    return () => {
      cancelled = true;
    };
  }, [scenario.id]);

  if (!data) return <section className="card">Loading schedule…</section>;
  const rows = showAll ? data.schedule : data.schedule.slice(0, PREVIEW_ROWS);

  return (
    <section className="card">
      <h2>Amortization — {scenario.name}</h2>
      <table>
        <thead>
          <tr>
            <th>Month</th>
            <th>Payment</th>
            <th>Principal</th>
            <th>Interest</th>
            <th>Balance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.month}>
              <td>{r.month}</td>
              <td>{money(r.payment)}</td>
              <td>{money(r.principal)}</td>
              <td>{money(r.interest)}</td>
              <td>{money(r.balance)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.schedule.length > PREVIEW_ROWS && (
        <button className="secondary" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show less" : `Show all ${data.schedule.length} months`}
        </button>
      )}
    </section>
  );
}
