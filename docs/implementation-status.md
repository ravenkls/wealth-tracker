# Implementation status

## Implemented locally

- pnpm workspaces, Node 24 LTS pinned to this repo, strict TypeScript, Vite, Vitest, Oxlint and Oxfmt. Host web/API processes; DynamoDB Local alone in Compose with persistent storage.
- Dark MUI app with Overview, Accounts, Budget and History routes, Recharts, responsive navigation and snapshot modal. The approved sample mockup remains available separately in development.
- Real Google authorization-code login with PKCE/state/nonce, browser binding, hashed opaque sessions, conditional 45-day sliding expiry and immediate logout. No login bypass.
- User-scoped ElectroDB entities in one table; conditional account/budget changes; atomic monthly snapshot/revision/operation receipts. Stale edits rejected; retries do not create duplicate revisions.
- Generic signed cash/debt accounts and manual pension accounts, rename/archive/restore, autosaved working balances and snapshot prefills.
- Trading 212 Invest/Stocks ISA connection management, encrypted local credentials, current values/holdings, read-only paginated cash history with resumable rate-limit handling. Disconnections remove credentials and retain recorded history.
- Current-month fetch-and-save, manual past monthly totals, correction of recorded manual values/notes, replacement warnings and revision inspection. Provider valuation failures block recording; incomplete history withholds inference without blocking net worth.
- TanStack Table 9 with MUI cells and dnd-kit: Accounts, History and budget line tables; inline editing, grouping, sorting, keyboard/pointer column and account/budget row dragging. Preferences sync per user across devices.
- Autosaved revision-preserving history corrections with frozen provider values; serialised budget autosave and visible validation/conflict errors. Record snapshot remains explicit.
- Budget line add/edit/reorder/remove, salary-frequency conversion, annual provisions, saving allocations, destination funding totals, emergency target, dynamic cash/investment split, cash/year-end/deposit goals.
- Inferred savings/spending with confirmed interval inputs, pension exclusion, explicit cash-income classification, elapsed-time-normalised projections, savings summaries and planned-versus-inferred comparison. See [calculation rules](calculation-rules.md).

- Recharts composition, asset mix, interval savings/rates, budget allocation/categories/spending/funding, working balances/holdings and component-history/change charts. Missing months remain gaps; negative values use signed bars. Date ranges and history series are selectable.
- Dashboard asset multi-select filters net-worth totals/comparisons, composition, asset mix and recorded balances while preserving budget/savings/goal calculations.
- Optional budget categories with MUI freeSolo autocomplete, case-insensitive canonical names, inline autosave and grouping. Yearly/recent savings-rate summaries are income-weighted.

- UI polish across live pages and dialogs: aligned table values, readable long labels/notes, responsive budget layouts, scrollable forms with visible actions and navigation scroll reset. See [UI review](ui-polish-review.md).

- Account-persisted light/dark appearance with a sidebar switch. Dark mode uses near-black surfaces; light mode uses white panels on a soft grey canvas. Tables, dialogs, controls, chart axes/tooltips and line contrast follow the theme. New users default to dark. A local cache applies the last confirmed theme before the first paint and while account settings load; the account remains authoritative. Appearance is stored separately from table preferences, with version checks and failed-save recovery.

- Accounts are separated into manually tracked Cash/Debt/Investment/Pension accounts and automated Trading 212 tracking. Cash/Debt can be reclassified inline without rewriting snapshots. Manual investment totals are included in recording/corrections, asset filters and funding destinations; savings/spending inference is withheld for affected intervals. Existing records need no migration.

- Snapshot balance entry uses a compact Account/Balance table, inheriting the manual-account grouping and row order. Groups open expanded and total draft balances; edits stay in the modal until recording. Browser checks covered signed totals, collapse/expand, validation, Enter behaviour, cancel/reopen and 390px layout without saving user records.

## Verification

- User confirmed real Google login and live Trading 212 account values/holdings load.
- Full formatting, lint, type-check, 100 unit tests and frontend production-build checks pass.
- Twenty DynamoDB integration tests pass using their own temporary table: expiry/revocation, OAuth replay, ownership, transaction conflicts, snapshot retries, blocked valuation failures, immutable provider corrections history pagination/rate-limit resumption, working balances/preferences, inline correction transactions and canonical budget-category persistence.
- Browser checks used an isolated temporary user for accounts, debts, pensions, budget saving, current recording, historical totals, correction/revisions, conflicting two-tab edits and responsive layout. Logout cleared its cookie and a subsequent private read returned 401. Temporary test records were removed.
- Table browser checks passed for persisted inline account/history/budget edits, grouping across reload, keyboard row dragging, synced column order, select editors, rapid budget edits, revision inspection and working-balance snapshot prefills. A stale two-tab edit was rejected with its typed value retained. No browser exceptions or mobile page overflow were observed; isolated test records/session were removed.
- Chart browser checks covered all four pages using existing records read-only; isolated component fixtures covered category blur/Enter/clear behaviour and signed values. Desktop and 390px mobile layouts were reviewed with no page overflow or browser errors. Fixture files were removed.
- Live savings reconciliation across two real monthly capture intervals has not yet occurred; calculation fixtures and provider-contract tests cover the supported cases. Ambiguous provider transfers deliberately show unavailable metrics.

## AWS deployment

Terraform and GitHub Actions deploy the app to `wealth.kristiansmith.dev`: private S3, CloudFront, HTTP API Gateway and one Node 24 Lambda in London. Production uses KMS credential encryption, Secrets Manager for Google OAuth, secure session cookies, protected DynamoDB storage and short-lived GitHub OIDC credentials. See [deployment and operations](../infra/README.md) for bootstrap, CI, migration and recovery.

The Google OAuth client's publishing/test-user restrictions are controlled in Google Cloud; application authorization itself accepts any successfully verified Google identity and isolates users' data.

Group headers default to expanded and show meaningful account/investment/budget sums. Browser fixtures verified negative-balance totals, collapse/expand, regrouping, reordered columns and reload defaults without touching stored user data. Budget aggregation tests cover mixed annual/monthly periods and invalid/missing inputs.

Imported history can be enriched with date-only London readings, declared Trading 212/cash coverage and an explicit monthly income assumption. Savings, spending, income-weighted rates and normalised projections then use real provider movements and interval income, including multi-month gaps. History details allow revision-preserving income corrections. No historical holdings or exact capture times are fabricated.

## Monzo automated cash tracking

Implemented user-supplied confidential OAuth clients, session-bound callbacks, encrypted rotating tokens, account/pot selection, automated cash snapshot readings and missing-pot archiving. Disconnect converts tracked accounts to manual. Existing manual accounts and saved history are preserved. See [Monzo integration](monzo-integration.md) for setup and lifecycle details. The user confirmed real authorization and matching personal account/pot balances. Live API inspection also confirmed business and Flex availability; both are now supported, with Flex classified as debt and its £0 balance confirmed by the user.

## Connection controls and holdings display

Automated tracking uses one Connect Account menu and per-row action menus leading to Manage Monzo or Manage Trading 212. Trading 212 management contains valuations, holdings, history refresh/retry and disconnect controls. Its table display is chosen during connection and can be changed later with autosave. Existing connections default to one account row; the holdings view replaces that row with individual holdings, uninvested cash and any reconciliation difference. This preference is stored per connection with version checks. Cash remains investments for calculations, and snapshots and savings continue using the account once. Monzo connections with no selected balances retain a management row in the table.

## Budget planning visuals

Budget now leads with a 12/24/60-month balance forecast driven by the editable plan, including monthly dynamic allocation and cash deficits. Forecast totals exclude pensions and the chart title states this explicitly. The income-flow Sankey replaces the allocation doughnut and shows category/destination funding, unassigned money and deficits. Existing category, spending and payday charts follow the editor. Essential expense flags and selected reserve accounts autosave with the budget; Budget and Overview show recorded reserve coverage and a target/history chart. No new accounts are selected or expenses classified automatically. See [calculation rules](calculation-rules.md) for the approved assumptions and missing-data behavior.
