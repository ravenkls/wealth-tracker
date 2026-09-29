import {
  simulateBudget,
  type BudgetPlan,
  type BudgetDestination,
  type Snapshot,
  type BudgetSimulation,
} from "@wealth/domain";
self.onmessage = (
  event: MessageEvent<{
    plan: BudgetPlan;
    latest: Snapshot | null;
    horizon: number;
    destinations: BudgetDestination[];
  }>,
) => {
  let result: BudgetSimulation;
  try {
    result = simulateBudget(event.data.plan, event.data.latest, event.data.horizon, {
      destinations: event.data.destinations,
    });
  } catch (cause) {
    result = {
      status: "unavailable",
      reason: cause instanceof Error ? cause.message : "Unable to calculate this simulation.",
    };
  }
  self.postMessage(result);
};
