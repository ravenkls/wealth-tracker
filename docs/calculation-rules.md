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

Unknown transaction/distribution types, ambiguous `TRANSFER` events, incomplete history, changed account coverage, absent confirmed inputs, or a missing/invalid capture interval make affected metrics unavailable. Do not infer historical savings from three manually entered monthly totals. Known deposit/withdrawal pairs across connected accounts cancel when combined; an ambiguous provider transfer is not guessed.

If either reading contains a manually tracked Investment account, inferred savings/spending and the interval savings rate are unavailable. No manual contribution or transaction inputs are collected; investment balance changes are not guessed to be contributions or returns. Manual investment balances remain included in net-worth totals, charts, budget allocation and goal progress.

Net worth may save while history is incomplete. History ingestion resumes from stored cursors and retries rate limits; a valuation failure still blocks the entire snapshot. Account-set changes with unknown opening/closing balances make inference unavailable until comparable readings exist.

## Projections and summaries

Use complete intervals wholly within the 365-day window ending at the latest captured reading, and starting on/after the optional job-start month in London. Sum savings and divide by their total covered days, then multiply by **30.436875** (365.2425 / 12) for a monthly rate. Do not treat a two-month interval as one month's saving or fill gaps with zeros. Six-month inferred spending applies the same normalisation to its shorter window.

Cash-goal progress uses latest recorded cash. With a positive monthly cash-saving rate, arrival is the latest recorded month plus `ceil((goal − cash) / monthly cash savings)`. Already met goals show reached; zero/negative or unavailable rates have no arrival date.

Year-end cash projection adds monthly cash savings for the remaining calendar months from the latest saved month to December of the current London year. The required monthly saving divides the remaining cash target by those remaining months, rather than the sheet's unconditional divisor of 12. The UI shows the recorded basis and year. No investment-return assumption is added.

Recorded year-to-date savings sum complete intervals associated with saved months in the current London year. Yearly and three-interval savings-rate summaries use total eligible savings divided by total eligible income. Only complete intervals with positive income and an available rate contribute to either side of that ratio; if none qualify, the rate is unavailable. The savings amount still includes all complete intervals. Trend compares the income-weighted rate for the latest three complete intervals with that for the preceding three. These are recorded interval summaries, not a claim to cover every calendar day.

House-deposit progress is **cash above the emergency target plus the chosen fraction of investments**. Its monthly contribution is the normalised total savings rate × the chosen deposit-saving fraction. Both fractions must be entered by the user; no silent 65% default. Arrival uses the same positive-rate/reached rules as cash goals.

These changes intentionally fix the identified projection and trend inconsistencies, as approved. The original spreadsheet formula inventory remains in [PRD section 15](PRD.md#15-budgeting-and-savings--approved-spreadsheet-parity).
