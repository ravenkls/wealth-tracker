# Chart design review

Status: approved and implemented locally, including optional budget categories and income-weighted savings summaries.

Source: Wealth Tracker Sheet (private reference). Read-only review on 28 September 2026 using live chart metadata, the Net Worth and Budget layouts, and the current app source.

## Spreadsheet inventory

| Sheet      | Existing charts                                                                                                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Net Worth  | Historical Net Worth; Current Asset Distribution; Historical Investments & Cash Savings (exc. Property); Total Savings Tracker; Investments & Cash Rate (exc. Pension); Year Savings Rate |
| Cash       | Cash Value History; Savings History; Savings Rate                                                                                                                                         |
| Budget     | Budget Breakdown; Overall Category Breakdown                                                                                                                                              |
| ETFs       | ETF Value History; ETF Purchase History; ETF Gains History; ETF Gains History (%); current and target regional allocation; current and target sector allocation                           |
| Retirement | Pension Value History; Pension History (£); Pension Gain History (%)                                                                                                                      |
| History    | Stocks Value; Cash Value; ETFs Value; Total Savings Tracker                                                                                                                               |
| Dividends  | One untitled chart; its title does not establish its series or calculation                                                                                                                |

The Net Worth layout uses stacked columns for historical net worth, a pie for current asset distribution, a savings amount/rate combination chart, and a yearly savings-rate gauge. Budget uses pies for individual allocations and category breakdown. Chart metadata establishes titles on the other tabs; those chart types and series have not been individually inspected.

Hidden tabs also contain managed-fund, stock, crypto, other-asset, property, liabilities and FIRE charts. These do not reinstate excluded product features.

## Gap identified in the review

Before this work, the app had one Recharts net-worth area chart. Its component balances, budget allocation, savings metrics and projections are mainly numeric summaries or progress bars. The spreadsheet's visual comparisons have not yet been carried across.

## Implemented page layout

Keep the existing dark MUI appearance, Recharts, concise copy and editable TanStack tables. Charts should have a clear purpose, short titles and useful tooltips. Use consistent cash, investment and pension colours across pages. Use two-column chart layouts on desktop and a single column on mobile. Tables remain the editing surface underneath the relevant visual summary.

| Page     | Visualisation                                                                                                      | Purpose                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Overview | Large net-worth chart with cash, investments and pensions as stacked monthly columns, with a total line            | Explain both the total and its composition; adapt the sheet's Historical Net Worth                      |
| Overview | Asset-mix doughnut, switching to signed bars if a component is negative                                            | Restore Current Asset Distribution without hiding debts or drawing negative pie slices                  |
| Overview | Savings amount bars with an aligned savings-rate line chart                                                        | Restore savings and rate trends, using the approved inference rather than changes in market value       |
| Overview | Compact year-to-date savings-rate and goal progress visuals                                                        | Restore the useful summary behind the sheet's gauge without spending a large panel on a dial            |
| Budget   | Ranked horizontal bars for budget items, normalised to monthly amounts                                             | Make major expenses easy to compare and retain the Budget Breakdown detail                              |
| Budget   | Income allocation chart for expenses, planned savings, surplus cash, surplus investments and unallocated remainder | Explain the dynamic allocation already calculated by the app; explicitly show a deficit when applicable |
| Budget   | Destination-account funding bars                                                                                   | Visualise existing per-payday transfer recommendations without executing transfers                      |
| Accounts | Signed horizontal account-balance bars                                                                             | Compare working cash/debt and pension balances above their table                                        |
| Accounts | Investment holdings allocation chart, including broker cash as a separate holding                                  | Visualise existing Trading 212 values; the whole brokerage account remains investments in net worth     |
| History  | Selectable cash/investment/pension value series                                                                    | Bring across component-history charts without separate investment-provider pages                        |
| History  | Positive/negative change bars between saved readings                                                               | Show when net worth changed most; label gaps with both months, not as a one-month change                |

Overview and History charts use saved snapshots. Accounts working balances and provider valuations must be clearly distinguished from recorded history. Selecting a date range should apply consistently to related historical charts. Missing months retain null values and no bars or data points, including June and August in the imported history. Line series connect consecutive recorded points across these gaps using straight segments; no intermediate values are saved or shown in tooltips.

## Data already available and limitations

The imported monthly cash, investment and pension totals can immediately drive historical composition, asset mix, component trends and changes. Existing budget and working-balance data can drive the proposed allocation/funding/account charts. Holdings charts use the provider's recorded valuation timestamp.

Imported totals alone cannot drive accurate historical savings, spending or investment returns. Savings charts require complete captured intervals, confirmed income and classified provider history under the agreed calculation rules. Show an honest unavailable state where needed. Irregular intervals must remain visibly labelled; do not present two months of saved money as one month's savings. The review originally described the yearly rate as already weighted; inspection found an arithmetic mean instead. The user approved correcting yearly and recent/previous three-interval summaries to total eligible savings divided by total eligible income. Zero-income intervals have no eligible rate.

Do not infer sector or geographical ETF exposure from ticker names. The original regional/sector charts need additional exposure data and allocation targets, neither of which is in the current app model. Investment-gain, purchase-history and pension-return charts also require data/calculations beyond monthly values and remain outside this proposal. Property, FIRE and other providers remain excluded.

Goal projection charts could visualise the already-approved projection rules later, using a dashed forecast and explicit target; no new growth assumptions are proposed.

## Approved category design

Budget expenses and planned savings have optional user-defined categories, independent of destination accounts. MUI Autocomplete with freeSolo allows choosing an existing category or typing a new one. Values are trimmed, matched case-insensitively and autosaved through the existing versioned budget flow. Blank values display as Uncategorised. There is no hardcoded taxonomy or separate category-management page.

Both tables support category grouping with expanded headers and the existing period-aware totals. Category charts combine monthly expenses and planned savings; surplus recommendations remain separately visible in the income-allocation chart. Old budget records without categories remain valid.

## Dashboard asset filter

The Overview header has a Net-worth assets multi-select for cash, investments and pensions. All are initially selected and at least one must remain selected. Selection is local to the current dashboard view, like its date range. It changes the headline total and comparison, stacked series and total line, component summaries, asset mix and recorded-balance list. Filtered totals are labelled Selected net worth. Missing months have no bars or points, while lines connect across them; negative balances retain their sign.

Budget, savings rates, inferred spending and goal calculations retain their full existing inputs. Filtering is presentation-only and never edits saved snapshots.
