import { calculateBudget, monthlyLine } from "./budget";
import { monthlyPay } from "./budget-rules";
import type { BudgetPlan, Snapshot } from "./models";

export interface BudgetFlowNode {
  id: string;
  name: string;
  kind:
    | "income"
    | "budget"
    | "expense"
    | "saving"
    | "cash"
    | "investment"
    | "unallocated"
    | "shortfall"
    | "destination";
}
export interface BudgetFlow {
  nodes: BudgetFlowNode[];
  links: { source: number; target: number; value: number }[];
}

/** Planned funding, including explicit shortfalls; every intermediate node conserves money. */
export function budgetFlow(
  plan: BudgetPlan,
  latest: Snapshot | null,
  destinations: readonly { id: string; name: string }[],
): BudgetFlow {
  const summary = calculateBudget(plan, latest);
  const nodes: BudgetFlowNode[] = [];
  const links: BudgetFlow["links"] = [];
  const ids = new Map<string, number>();
  const node = (id: string, name: string, kind: BudgetFlowNode["kind"]) => {
    let index = ids.get(id);
    if (index === undefined) {
      index = nodes.length;
      ids.set(id, index);
      nodes.push({ id, name, kind });
    }
    return index;
  };
  const link = (source: number, target: number, value: number) => {
    const existing = links.find((item) => item.source === source && item.target === target);
    if (existing) existing.value += value;
    else links.push({ source, target, value });
  };
  if (summary.income === 0 && summary.spending === 0 && summary.explicitSavings === 0)
    return { nodes, links };
  const pool = node("budget", "Monthly plan", "budget");
  const salary = monthlyPay(plan.salary, plan.payFrequency);
  if (salary > 0) link(node("salary", "Take-home pay", "income"), pool, salary);
  if (plan.sideIncome > 0) link(node("side", "Side income", "income"), pool, plan.sideIncome);
  if (summary.surplus < 0)
    link(node("shortfall", "Funding shortfall", "shortfall"), pool, -summary.surplus);
  const allocate = (
    id: string,
    name: string,
    kind: BudgetFlowNode["kind"],
    destination: string | null,
    value: number,
  ) => {
    if (value <= 0) return;
    const purpose = node(id, name, kind);
    const target = destination
      ? node(
          `destination:${destination}`,
          destinations.find((item) => item.id === destination)?.name ?? "Unavailable account",
          "destination",
        )
      : node("unassigned-destination", "Unassigned", "unallocated");
    link(pool, purpose, value);
    link(purpose, target, value);
  };
  for (const line of plan.expenses) {
    const category = line.category?.trim() || "Uncategorised";
    allocate(
      `expense:${category.toLowerCase()}`,
      category,
      "expense",
      line.destinationId,
      monthlyLine(line),
    );
  }
  for (const line of plan.savingsAllocations) {
    const category = line.category?.trim() || "Planned savings";
    allocate(
      `saving:${category.toLowerCase()}`,
      category + (category === "Planned savings" ? "" : " savings"),
      "saving",
      line.destinationId,
      monthlyLine(line),
    );
  }
  if (summary.surplus > 0) {
    if (summary.cashAllocation === null || summary.investmentAllocation === null) {
      allocate("surplus", "Unallocated surplus", "unallocated", null, summary.surplus);
    } else {
      allocate("cash", "Surplus to cash", "cash", plan.cashDestinationId, summary.cashAllocation);
      allocate(
        "investments",
        "Surplus to investments",
        "investment",
        plan.investmentDestinationId,
        summary.investmentAllocation,
      );
      allocate("remainder", "Rounding remainder", "unallocated", null, summary.remainder ?? 0);
    }
  }
  return { nodes, links };
}
