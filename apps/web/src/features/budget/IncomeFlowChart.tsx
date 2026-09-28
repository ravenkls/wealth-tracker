import { useMemo } from "react";
import { Box, Typography } from "@mui/material";
import {
  Sankey,
  ResponsiveContainer,
  Tooltip,
  type SankeyNodeProps,
  type SankeyLinkProps,
} from "recharts";
import {
  budgetFlow,
  calculateBudget,
  formatGbp,
  pence,
  type BudgetPlan,
  type BudgetFlowNode,
  type Snapshot,
} from "@wealth/domain";
import { ChartFrame, ChartEmpty, tooltipStyle } from "../../components/charts/ChartFrame";
import { colors, categoryColor } from "../../components/charts/chartData";

function nodeColor(node: BudgetFlowNode) {
  if (node.kind === "shortfall") return colors.negative;
  if (node.kind === "expense") return categoryColor(node.name);
  if (node.kind === "cash" || node.kind === "income") return colors.cash;
  if (node.kind === "investment" || node.kind === "saving") return colors.investments;
  return "#88929f";
}
function FlowNode({
  x,
  y,
  width,
  height,
  payload,
  node,
}: SankeyNodeProps & { node: BudgetFlowNode }) {
  const terminal = payload.targetNodes.length === 0;
  const label = String(payload.name);
  return (
    <g>
      <title>
        {label}: {formatGbp(pence(payload.value))}
      </title>
      <rect x={x} y={y} width={width} height={Math.max(height, 1)} rx={3} fill={nodeColor(node)} />
      <text
        x={terminal ? x - 10 : x + width + 10}
        y={y + height / 2 - 3}
        textAnchor={terminal ? "end" : "start"}
        fill="var(--chart-text)"
        fontSize={12}
        paintOrder="stroke"
        stroke="var(--chart-surface)"
        strokeWidth={4}
        strokeLinejoin="round"
      >
        {label.length > 26 ? label.slice(0, 25) + "…" : label}
        <tspan
          x={terminal ? x - 10 : x + width + 10}
          dy={17}
          fontSize={11}
          fill="var(--chart-muted)"
        >
          {formatGbp(pence(payload.value))}
        </tspan>
      </text>
    </g>
  );
}
function FlowLink({
  sourceX,
  sourceY,
  sourceControlX,
  targetControlX,
  targetX,
  targetY,
  linkWidth,
  color,
}: SankeyLinkProps & { color: string }) {
  return (
    <path
      d={`M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
      fill="none"
      stroke={color}
      strokeOpacity={0.23}
      strokeWidth={linkWidth}
    />
  );
}
export function IncomeFlowChart({
  plan,
  latest,
  destinations,
}: {
  readonly plan: BudgetPlan;
  readonly latest: Snapshot | null;
  readonly destinations: readonly { id: string; name: string }[];
}) {
  const flow = useMemo(() => budgetFlow(plan, latest, destinations), [plan, latest, destinations]);
  const summary = calculateBudget(plan, latest);
  const purposes = flow.nodes.filter(
    (node) => !["income", "budget", "shortfall", "destination"].includes(node.kind),
  ).length;
  const targets = flow.nodes.filter((node) => node.kind === "destination").length;
  const height = Math.max(330, Math.max(purposes, targets) * 54 + 40);
  return (
    <ChartFrame title="Income flow" subtitle="Monthly planned funding by purpose and destination">
      {summary.surplus < 0 && (
        <Typography color="error.main" sx={{ fontSize: 13, mb: 2 }}>
          Funding shortfall: {formatGbp(pence(-summary.surplus))}
        </Typography>
      )}
      {!flow.links.length ? (
        <ChartEmpty>Add income or budget items to see your plan.</ChartEmpty>
      ) : (
        <Box
          sx={{ overflowX: "auto" }}
          tabIndex={0}
          component="section"
          aria-label="Income flow chart scroll area"
        >
          <Box sx={{ height, minWidth: 850 }}>
            <ResponsiveContainer width="100%" height="100%">
              <Sankey
                data={flow}
                node={(props) => <FlowNode {...props} node={flow.nodes[props.index]!} />}
                link={(props) => (
                  <FlowLink
                    {...props}
                    color={nodeColor(
                      flow.nodes[flow.links[props.index]!.source]!.kind === "budget"
                        ? flow.nodes[flow.links[props.index]!.target]!
                        : flow.nodes[flow.links[props.index]!.source]!,
                    )}
                  />
                )}
                nodePadding={32}
                nodeWidth={10}
                iterations={40}
                margin={{ top: 20, bottom: 20, left: 0, right: 0 }}
                accessibilityLayer
              >
                <Tooltip
                  formatter={(value) => formatGbp(pence(Number(value)))}
                  contentStyle={tooltipStyle}
                  itemStyle={{ color: "var(--chart-text)" }}
                />
              </Sankey>
            </ResponsiveContainer>
          </Box>
        </Box>
      )}
    </ChartFrame>
  );
}
