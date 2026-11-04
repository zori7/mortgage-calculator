import { useCallback, useEffect, useState } from "react";
import type { ScenarioWithSummary } from "@mt/shared";
import { api } from "./api.js";
import { Calculator } from "./components/Calculator.js";
import { ScenarioList } from "./components/ScenarioList.js";
import { ScheduleTable } from "./components/ScheduleTable.js";

export function App() {
  const [scenarios, setScenarios] = useState<ScenarioWithSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setScenarios(await api.list());
      setError(null);
    } catch {
      setError("Can't reach the API. Is `pnpm dev` running and the DB up?");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selected = scenarios.find((s) => s.id === selectedId) ?? null;

  return (
    <main>
      <header>
        <h1>Mortgage Tracker</h1>
        <p className="muted">Calculate a loan, save it, compare later.</p>
      </header>

      {error && <div className="banner">{error}</div>}

      <div className="grid">
        <Calculator onSaved={refresh} />
        <ScenarioList
          scenarios={scenarios}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onDelete={async (id) => {
            await api.remove(id);
            if (id === selectedId) setSelectedId(null);
            await refresh();
          }}
        />
      </div>

      {selected && <ScheduleTable scenario={selected} />}
    </main>
  );
}
