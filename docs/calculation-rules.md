# Financial calculation rules

These are the user-approved adaptations of the spreadsheet, implemented in `packages/domain`. All stored money is integer GBP pence. Decimal conversions and allocation rounding use decimal arithmetic.

## Monthly net worth

`net cash + manual investment balances + full Trading 212 account totals + manual pensions`.

Net cash includes signed Cash and Debt balances. Cash/Debt reclassification does not change totals or historical records. Brokerage cash stays in investments, and holdings are not added again to the account total. One active snapshot exists per literal `YYYY-MM`, with previous revisions retained. Europe/London determines the current month and year; UTC capture timestamps support inference, not snapshot identity. Charts leave missing months missing.

## Budget

Monthly income is converted take-home pay plus monthly side income. Preserve the spreadsheet's conversion factors: monthly 1, twice monthly 2, weekly 4.34523783659, fortnightly 2.172618918295, four-weekly 1.0833333333. Annual expenses/saving allocations are divided by 12. Values are rounded to pence.

- Planned spending is expenses only; explicit saving allocations remain savings.
- Surplus is income minus expenses minus explicit saving allocations.
- Emergency target is expenses × selected months, rounded **up to £1,000**.
- Recorded cash share is cash / (cash + manual investments + full brokerage value); pensions are excluded.
- Adjusted cash share is `target + strength × (target − recorded share)`, rounded away from zero to two decimals and clamped to 0–1. Strength is 1, 2 or 3.
- Cash below the emergency target forces the surplus cash share to 100%. Otherwise a nonpositive denominator makes the split unavailable.
- Cash and investment recommendations are rounded independently **down to £10**. The remainder stays unallocated. Negative surplus remains visible; no negative transfers are recommended.
- Funding instructions sum expense provisions, explicit savings and dynamic allocations by generic destination account, then convert back to the selected pay frequency. They do not execute payments.
- Planned savings rate is `(income − expenses) / income`; zero income has no rate.

## Inferred savings and spending

Use the actual interval **after the previous capture time through the current capture time**, `(previous, current]`. Confirm income actually received over that interval; the monthly budget is only a prefill. Confirm the optional pension amount paid from cash (zero is valid).

```text
net brokerage deposits = deposits − withdrawals
qualifying investment income = identifiable dividends + cash/lending interest
cash saved = current cash − previous cash
saved excluding pensions = cash saved + net brokerage deposits
                           + qualifying investment income − brokerage fees
income = confirmed period income + qualifying investment income
inferred spending = income − saved excluding pensions − pension contributions paid from cash
savings rate = saved excluding pensions / income, when income > 0
```

Market growth, pension growth and purchases/sales within a brokerage account are not new savings. Employer/salary-sacrifice contributions need no input. Pension payments from cash are neither spending nor included in the savings-rate numerator. Return-of-capital and capital distributions are not income.

Unknown transaction/distribution types, ambiguous `TRANSFER` events, incomplete history, changed account coverage, absent confirmed inputs, or a missing/invalid capture interval make affected metrics unavailable. Historical totals alone cannot establish savings. Enriched history may supply a date-only reading, a declared set of Trading 212 connections, consistent aggregate cash coverage, interval income and cash-paid pension contributions. Use those inputs with complete provider history; never invent historical holdings or brokerage cash. Date-only readings use the start of the specified date in Europe/London as the interval boundary. Known deposit/withdrawal pairs across connected accounts cancel when combined; an ambiguous provider transfer is not guessed.

If either reading contains a manually tracked Investment account, inferred savings/spending and the interval savings rate are unavailable. No manual contribution or transaction inputs are collected; investment balance changes are not guessed to be contributions or returns. Manual investment balances remain included in net-worth totals, charts, budget allocation and goal progress.

Net worth may save while history is incomplete. History ingestion resumes from stored cursors and retries rate limits; a valuation failure still blocks the entire snapshot. Account-set changes with unknown opening/closing balances make inference unavailable until comparable readings exist.

## Enriched historical readings

Historical imports remain totals with their original balances and immutable prior revisions. Reading dates and account coverage are separate metadata; `capturedAt` remains null because no live valuation was fetched. A user-approved monthly income assumption is multiplied by the number of calendar months between readings, including gaps. The first reading is only a baseline. The assumption is shown in History details and dashboard savings information; editing an interval's income replaces its assumed status with a confirmed value.

Two aggregate readings must declare the same cash coverage and connected investment accounts. Switching from aggregate imports to individual recorded accounts does not silently assert equivalent coverage. Manual-investment restrictions still apply. Ordinary manual historical entries without this metadata remain unavailable for savings. An operator migration adds the approved metadata using conditional saves and new revisions, with a private backup and idempotent receipts.

## Projections and summaries

Use complete intervals wholly within the 365-day window ending at the latest captured reading, and starting on/after the optional job-start month in London. Sum savings and divide by their total covered days, then multiply by **30.436875** (365.2425 / 12) for a monthly rate. Do not treat a two-month interval as one month's saving or fill gaps with zeros. Six-month inferred spending applies the same normalisation to its shorter window.

Cash-goal progress uses latest recorded cash. With a positive monthly cash-saving rate, arrival is the latest recorded month plus `ceil((goal − cash) / monthly cash savings)`. Already met goals show reached; zero/negative or unavailable rates have no arrival date.

Year-end cash projection adds monthly cash savings for the remaining calendar months from the latest saved month to December of the current London year. The required monthly saving divides the remaining cash target by those remaining months, rather than the sheet's unconditional divisor of 12. The UI shows the recorded basis and year. No investment-return assumption is added.

Recorded year-to-date savings sum complete intervals associated with saved months in the current London year. Yearly and three-interval savings-rate summaries use total eligible savings divided by total eligible income. Only complete intervals with positive income and an available rate contribute to either side of that ratio; if none qualify, the rate is unavailable. The savings amount still includes all complete intervals. Trend compares the income-weighted rate for the latest three complete intervals with that for the preceding three. These are recorded interval summaries, not a claim to cover every calendar day.

House-deposit progress is **cash above the emergency target plus the chosen fraction of investments**. Its monthly contribution is the normalised total savings rate × the chosen deposit-saving fraction. Both fractions must be entered by the user; no silent 65% default. Arrival uses the same positive-rate/reached rules as cash goals.

These changes intentionally fix the identified projection and trend inconsistencies, as approved. The original spreadsheet formula inventory remains in [PRD section 15](PRD.md#15-budgeting-and-savings--approved-spreadsheet-parity).

## Budget-driven balance forecast

The forecast starts from the latest recorded snapshot and repeats the current budget for 12, 24 or 60 complete monthly steps. Income uses the existing pay-frequency conversion; annual costs use monthly provisions, so this is not a within-month cash-flow calendar. Each step recalculates the existing dynamic split from the previous projected cash/investment balances. Investment growth and interest are zero. Forecast totals include net cash and investments only, excluding pensions from the starting point and every projected month; recorded net worth elsewhere is unchanged. Explicit savings stay in cash. Cash increases by income minus expenses minus the rounded investment allocation; this retains rounding leftovers in cash without assigning a recommended transfer. A deficit reduces cash, with no negative investment transfer. Missing split inputs with a positive surplus withhold the forecast rather than invent an allocation. These estimates do not replace the existing history-based goal projections or save forecast snapshots.

## Income flow

The diagram shows the current plan’s monthly funding: income sources, the monthly plan, spending/saving purposes and destination accounts. An income deficit is an explicit funding-shortfall source, not income. Unassigned destinations and unallocated surplus/rounding remain visible. All intermediate nodes conserve the full amount; internal transfers are not extra expenses.

## Emergency reserve coverage

Users select their own active Cash accounts (including automated Monzo accounts/pots) and explicitly mark essential expense lines. Each saved snapshot’s selected cash balances are summed and divided by the current budget’s essential monthly expense total. Annual essentials use monthly provisions. Debt, investments and pensions are excluded. Missing selected account balances make that reading unavailable, including imported monthly totals with no account detail. Negative reserve totals provide zero months of cover; zero essential costs provide no estimate. The history uses today’s selections and essential costs, not historical expense estimates. The existing emergency-month setting provides the coverage target; the coverage view does not change the existing allocation emergency target or dynamic rules. Settings autosave with the budget and use its version checks.
