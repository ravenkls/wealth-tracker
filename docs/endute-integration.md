# Endute Connect

Accounts → Connect → Connect Endute Connect accepts one API key. Link and enable accounts in the [Endute portal](https://connect.endute.com/) first, then choose which returned balances to track. This integration supports GBP current, savings, cash, credit-card and loan accounts. Unknown types and other currencies are excluded with an explanation. Correct missing account types in the portal. Sandbox accounts are labelled. Deselect duplicate accounts already tracked through Monzo or archive their manual equivalents.

## Credentials and lifecycle

[Authentication](https://endute.com/connect/docs/authentication) uses a bearer key beginning `edk_`; there is no OAuth callback or separate secret. The key format is validated before connecting. Each app user has one Endute connection, stored in the existing bank records. Keys use the existing local AES-GCM / production KMS cipher, bound to the app user and connection. Bootstrap and mutation responses exclude credentials. Key replacement validates the new account set before committing and retains tracked account identities. Revoked keys prompt replacement; subscription failures direct the user to Endute.

Selection, refresh, deselection and disconnect use optimistic versions and atomic account/connection writes. Refresh also takes a persisted lease. Deselection archives accounts; reselection restores their IDs. Disconnect removes the stored key and converts accounts to manual without changing their last balances or saved history. It does not revoke the key or disconnect banks in Endute; those remain managed in the portal.

## Balances and snapshots

The client reads `/v1/accounts`, `/v1/connections` and each supported account's `/balances`, using fixed HTTPS URLs, no redirects and a 20-second overall read deadline. Decimal amounts are rounded to integer pence without binary multiplication. Credit cards and loans retain the provider's signed balance and use the debt category. The [schema](https://api.endute.com/v1/openapi.json) documents credit-card balances as money owed, rather than available credit.

[Freshness documentation](https://endute.com/connect/docs/data-freshness) distinguishes API retrieval from bank refresh. Each displayed and recorded balance retains its own `fetched_at`; clicking Refresh does not force a bank sync. Null balance/timestamp pairs are unavailable, never zero. Unsynced accounts are excluded from initial selection with a warning. If a previously selected account becomes unavailable or unsupported, refresh and snapshot recording fail while retaining previous values. A complete response that omits an account archives it. Saved snapshots remain immutable during refresh.

[Consent documentation](https://endute.com/connect/docs/reconsent) explains that expired/suspended connections continue serving cached data. The UI warns about non-linked connection statuses and approaching consent deadlines and links to the portal. Cached balances remain usable with their original timestamps; a quiet transaction timestamp alone does not imply failed consent. The API does not associate bank account rows with connection IDs, so connection-status warnings are displayed for the whole service.

## Other API capabilities reviewed

The [endpoint reference](https://endute.com/connect/docs/endpoints) also covers transaction feeds, investment connections/accounts, positions, activities and a ZIP export. Investments are outside this release: positions alone do not supply a documented complete account valuation including cash. No investment totals are inferred. Bank transactions are also outside this release; existing balance-based savings calculations continue unchanged.

For future history ingestion, [pagination and errors](https://endute.com/connect/docs/pagination-and-errors) specifies newest-first transaction pages of 100 and `next` links, with ID deduplication. Investment activities instead cap at 500 and report `truncated`; dated filters omit undated activities. Errors use stable codes. Rate limits are 120 requests/minute/key and 50,000/day/account. The client bounds concurrency and saves `Retry-After` on refresh failures to prevent immediate retries.

[Webhooks](https://endute.com/connect/docs/webhooks) are optional change notifications, requiring portal registration and verification. A future receiver would validate HMAC-SHA256 over the raw timestamp/body, use constant-time comparison and a five-minute window, deduplicate event IDs, acknowledge promptly and fetch data separately. Retries are finite, so reconciliation reads remain necessary. No webhook endpoint is needed for the current user-triggered refresh flow.

[SimpleFIN](https://endute.com/connect/docs/bank-sync) is an alternative interface with a single-use setup-token claim and subsequent Basic-auth access URL. It is separate from this integration's bearer API key and is not implemented here.

## Verification

Provider and router tests cover response validation, null balances, signed debt, precision, consent warnings, safe errors, throttling and authentication/origin checks. DynamoDB tests exercise key encryption/isolation/replacement, account identity, unavailable balances, archiving, leases, retry times, disconnect/reconnect and mixed Monzo/Endute snapshots with immutable cached timestamps. Live Endute access requires a user-provided key and has not been exercised by these tests.
