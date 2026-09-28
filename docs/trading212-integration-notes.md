# Trading 212 integration evidence

Verified against the official API documentation during implementation, 28 September 2026. The user also confirmed a real connection, GBP account value and holdings load successfully. Live two-reading savings reconciliation remains unverified.

- [Account summary](https://docs.trading212.com/api/accounts/getaccountsummary): `id`, `currency`, `totalValue`, cash breakdown and investment values. Use `totalValue` once; do not add positions or cash again. Rate limit: one request per five seconds.
- [Positions](https://docs.trading212.com/api/positions/getpositions): instrument identity/currency, quantity and `walletImpact.currentValue` with its own currency. Use wallet-impact GBP amounts for display, never instrument prices relabelled as GBP. Rate limit: one request per second.
- [Transactions](https://docs.trading212.com/api/historical-events/transactions.md): reference, amount, currency, dateTime, type; paginated via `nextPagePath`, up to 50 items/page. Types include DEPOSIT, WITHDRAW, FEE, TRANSFER, INTEREST_ON_FREE_CASH and LENDING_INTEREST.
- [Dividends](https://docs.trading212.com/api/historical-events/dividends.md): reference, amount in account currency, paidOn and distribution type; paginated, up to 50 items/page. Types include ordinary income and return-of-capital/capital distributions, so treating every dividend response as income is not justified.

Both history endpoints allow six requests per minute. Account summary does not report Invest versus ISA in the reviewed response; the connection form must label the selected account type without pretending the response verified it.

The read-only adapter accepts API key plus secret for Basic authentication and only requests fixed official GET endpoints. It validates returned currency, rejects partial/malformed data, and rejects off-origin or wrong-resource pagination links. It does not log credentials or provider bodies.

## Implemented history policy

- The documented TRANSFER type does not by itself establish direction or whether it is an internal Invest/ISA transfer. The approved treatment is to mark affected inference unavailable; do not silently guess.
- Unknown event types, unsupported currencies and incomplete pagination cannot become zero cash flows.
- Large histories may require multiple rate-limited requests. History acquisition must not silently violate rate limits or become an unbounded synchronous operation.
- History-only failures do not block net-worth saving. Resume from persisted cursors; match events to actual UTC capture intervals. Identifiable dividends/interest count as income and saved money; fees reduce savings; capital distributions do not count as income. See [calculation rules](calculation-rules.md).
