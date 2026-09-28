import { useEffect, useState } from "react";
import type { BudgetPlan, BudgetSimulation, Snapshot } from "@wealth/domain";
export function useBudgetSimulation(
  plan: BudgetPlan | null,
  latest: Snapshot | null,
  horizon: number,
) {
  const signature = JSON.stringify({ plan, latest, horizon });
  const [state, setState] = useState<{ signature: string; result: BudgetSimulation } | null>(null);
  useEffect(() => {
    const input = JSON.parse(signature) as {
      plan: BudgetPlan | null;
      latest: Snapshot | null;
      horizon: number;
    };
    if (!input.plan) return;
    const worker = new Worker(new URL("./forecast.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<BudgetSimulation>) =>
      setState({ signature, result: event.data });
    worker.onerror = () =>
      setState({
        signature,
        result: {
          status: "unavailable",
          reason: "The simulation could not run. Reload to try again.",
        },
      });
    worker.postMessage(input);
    return () => worker.terminate();
  }, [signature]);
  return state?.signature === signature ? state.result : null;
}
