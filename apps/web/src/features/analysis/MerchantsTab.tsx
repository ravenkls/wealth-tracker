import { useState } from "react";
import { Box, Chip, InputAdornment, Paper, Stack, TextField, Typography } from "@mui/material";
import { DataTable } from "../../components/table/DataTable";
import type { AppData } from "../../lib/data";
import { categoryColour, categoryPillStyles } from "./categoryColours";
import { CategoryDot } from "./CategoryPill";
import type { Analysis } from "./ledgerModel";
import { formatDate } from "./highlights";
import { MerchantLink, Muted, Sparkline, StatTile } from "./parts";

export function MerchantsTab({
  analysis,
  money,
  onMerchant,
  data,
}: {
  readonly analysis: Analysis;
  readonly money: (value: number) => string;
  readonly onMerchant: (name: string) => void;
  readonly data: AppData;
}) {
  const [search, setSearch] = useState("");
  const merchants = analysis.merchants;
  const thisMonth = merchants
    .filter((merchant) => merchant.spent > 0)
    .sort((a, b) => b.spent - a.spent);
  const fresh = thisMonth.filter((merchant) => merchant.isNew);
  const loyal = merchants.filter(
    (merchant) =>
      merchant.monthCount >= Math.min(6, analysis.months.filter((flow) => flow.covered).length) &&
      merchant.monthCount > 1,
  );
  const topShare = thisMonth.length ? thisMonth[0]!.spent / analysis.current.moneyOut : 0;
  const query = search.trim().toLowerCase();
  const rows = query
    ? merchants.filter(
        (merchant) =>
          merchant.key.includes(query) ||
          (analysis.names.get(merchant.categoryId) ?? "").toLowerCase().includes(query),
      )
    : merchants;
  const coveredMonths = analysis.months.filter((flow) => flow.covered).length;
  return (
    <>
      <Paper variant="outlined" sx={{ mb: 2.5, overflow: "hidden" }}>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "repeat(2,minmax(0,1fr))", md: "repeat(4,minmax(0,1fr))" },
          }}
        >
          <StatTile
            label="Merchants this month"
            explanation="Distinct merchants you paid in the selected month."
            value={thisMonth.length.toLocaleString()}
            footer={<Muted>{merchants.length.toLocaleString()} across the range</Muted>}
          />
          <StatTile
            label="New this month"
            explanation="Merchants paid for the first time within the selected range."
            value={fresh.length.toLocaleString()}
            footer={
              <Muted>{money(fresh.reduce((sum, merchant) => sum + merchant.spent, 0))} spent</Muted>
            }
          />
          <StatTile
            label="Regulars"
            explanation="Merchants paid in at least six months of the range (or every month, for shorter ranges)."
            value={loyal.length.toLocaleString()}
            footer={
              <Muted>
                {money(
                  loyal.reduce((sum, merchant) => sum + merchant.total, 0) /
                    Math.max(1, coveredMonths),
                )}{" "}
                a month
              </Muted>
            }
          />
          <StatTile
            label="Top merchant share"
            explanation="Share of this month's outgoings that went to your largest merchant."
            value={`${Math.round(topShare * 100)}%`}
            footer={<Muted>{thisMonth[0]?.name ?? "—"}</Muted>}
          />
        </Box>
        {!!fresh.length && (
          <Box sx={{ borderTop: 1, borderColor: "divider", p: { xs: 2, sm: 2.5 } }}>
            <Typography sx={{ fontSize: 12, color: "text.secondary", mb: 1 }}>
              First time this month
            </Typography>
            <Stack direction="row" useFlexGap sx={{ gap: 0.75, flexWrap: "wrap" }}>
              {fresh.slice(0, 16).map((merchant) => (
                <Chip
                  key={merchant.key}
                  size="small"
                  variant="outlined"
                  icon={<CategoryDot id={merchant.categoryId} />}
                  label={`${merchant.name} · ${money(merchant.spent)}`}
                  onClick={() => onMerchant(merchant.name)}
                  sx={categoryPillStyles(merchant.categoryId)}
                />
              ))}
            </Stack>
          </Box>
        )}
      </Paper>
      <TextField
        size="small"
        label="Search merchants or categories"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        sx={{ mb: 1.5, width: { xs: "100%", sm: 320 } }}
        slotProps={{
          input: { endAdornment: <InputAdornment position="end">{rows.length}</InputAdornment> },
        }}
      />
      <DataTable
        id="merchants"
        label="Merchants"
        data={data}
        rows={rows}
        rowId={(row) => row.key}
        columns={[
          {
            id: "merchant",
            label: "Merchant",
            minWidth: 200,
            value: (row) => row.name,
            render: (row) => (
              <Stack
                direction="row"
                sx={{ alignItems: "center", gap: 1, minWidth: 0, maxWidth: 260 }}
              >
                <MerchantLink name={row.name} onClick={() => onMerchant(row.name)} />
                {row.isNew && (
                  <Typography sx={{ fontSize: 10, fontWeight: 600, color: "primary.main" }}>
                    NEW
                  </Typography>
                )}
              </Stack>
            ),
          },
          {
            id: "category",
            label: "Category",
            minWidth: 150,
            groupable: true,
            value: (row) => analysis.names.get(row.categoryId) ?? "Uncategorised",
            render: (row) => (
              <Stack direction="row" sx={{ alignItems: "center" }}>
                <CategoryDot id={row.categoryId} />
                {analysis.names.get(row.categoryId) ?? "Uncategorised"}
              </Stack>
            ),
          },
          {
            id: "month",
            label: "This month",
            align: "right",
            value: (row) => row.spent,
            render: (row) => (row.spent ? money(row.spent) : "—"),
          },
          {
            id: "total",
            label: "Total",
            align: "right",
            value: (row) => row.total,
            render: (row) => <Box sx={{ fontWeight: 600 }}>{money(row.total)}</Box>,
          },
          { id: "visits", label: "Payments", align: "right", value: (row) => row.count },
          {
            id: "average",
            label: "Avg payment",
            align: "right",
            value: (row) => row.average,
            render: (row) => money(row.average),
          },
          {
            id: "months",
            label: "Months",
            align: "right",
            value: (row) => row.monthCount,
            render: (row) => `${row.monthCount}/${coveredMonths}`,
          },
          {
            id: "last",
            label: "Last paid",
            align: "right",
            value: (row) => row.last,
            render: (row) => formatDate(row.last, true),
          },
          {
            id: "trend",
            label: "Trend",
            sortable: false,
            value: () => null,
            render: (row) => (
              <Sparkline
                values={row.series.map((value, index) =>
                  analysis.months[index]!.covered ? value : null,
                )}
                colour={categoryColour(row.categoryId)}
                width={84}
                height={22}
              />
            ),
          },
        ]}
      />
    </>
  );
}
