# UI polish review

The approved dark MUI direction remains: background #161b23, surfaces #1c222c, primary text #edf0f6, cash #98abd2, investments #8dbca5 and pensions #d4ac7c. Keep the existing system typography, centred 1600px content container, muted charts and concise labels. Use consistent section headings, aligned values and deliberate spacing rather than additional decoration.

## Changes

- Shared tables: align numeric headers with values, constrain currency editors, give names/destinations room, soften drag handles until hovered/focused, label action columns and make horizontal scrolling keyboard-accessible. Notes show two lines and expand while editing; long error messages wrap.
- Overview: replace empty savings placeholders with a compact explanation; keep existing asset filters, joined lines and financial calculations.
- Accounts: wrap full chart labels, keep signed balances and rank them by magnitude, use explicit Show all/Show fewer controls for charts with more than six entries, improve headings and wrap connection actions. Holdings values stay aligned alongside long names.
- Budget: move the summary beside the form only at wide desktop sizes, make tall summaries scroll within the viewport, shorten long field labels and prevent amounts from wrapping. Avoid repeated category colours within the available palette. Chart axes sit above horizontal bars instead of below a clipped scrolling area.
- History: place series controls in the chart header to align the two plots, wrap notes and present revision totals as aligned rows.
- Dialogs: consistent padding and dividers, fixed title/actions with a scrollable form body, 16px mobile gutters and a two-column recording form where space permits. Lazy-loading the snapshot dialog no longer replaces the page beneath it.
- Navigation: reset scroll position when changing pages; preserve position during edits and refetches. Development tools collapse when healthy. Shared keyboard focus styles and scrollbar treatment remain visible.

## Review scope

Reviewed the four live pages at desktop and 390px mobile widths, the intermediate budget layout, add-account and connection forms, holdings, current/historical snapshot forms, history details/revisions and sign-in. Existing user data was inspected read-only; editor commits were checked with an isolated fixture that was subsequently removed. No financial calculations, account data or saved snapshots are changed by this pass.

Validation: formatting, lint, TypeScript, all 64 unit tests and the production build passed. Fresh browser navigation through all four live pages produced no warnings or errors. Mobile page and dialog overflow checks passed; viewport overrides were reset.
