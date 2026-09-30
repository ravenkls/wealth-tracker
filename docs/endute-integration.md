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

The [endpoint reference](https://endute.com/connect/docs/endpoints) also covers transaction feeds, investment connections/accounts, positions, activities and a ZIP export. Investments are outside this release: positions alone do not supply a documented complete account valuation including cash. No investment totals are inferred. Bank transactions are imported for Analysis; existing balance-based savings calculations continue unchanged.

For future history ingestion, [pagination and errors](https://endute.com/connect/docs/pagination-and-errors) specifies newest-first transaction pages of 100 and `next` links, with ID deduplication. Investment activities instead cap at 500 and report `truncated`; dated filters omit undated activities. Errors use stable codes. Rate limits are 120 requests/minute/key and 50,000/day/account. The client bounds concurrency and saves `Retry-After` on refresh failures to prevent immediate retries.

[Webhooks](https://endute.com/connect/docs/webhooks) are optional change notifications, requiring portal registration and verification. A future receiver would validate HMAC-SHA256 over the raw timestamp/body, use constant-time comparison and a five-minute window, deduplicate event IDs, acknowledge promptly and fetch data separately. Retries are finite, so reconciliation reads remain necessary. No webhook endpoint is needed for the current user-triggered refresh flow.

[SimpleFIN](https://endute.com/connect/docs/bank-sync) is an alternative interface with a single-use setup-token claim and subsequent Basic-auth access URL. It is separate from this integration's bearer API key and is not implemented here.

## Verification

Provider and router tests cover response validation, null balances, signed debt, precision, consent warnings, safe errors, throttling and authentication/origin checks. DynamoDB tests exercise key encryption/isolation/replacement, account identity, unavailable balances, archiving, leases, retry times, disconnect/reconnect and mixed Monzo/Endute snapshots with immutable cached timestamps. Live Endute access requires a user-provided key and has not been exercised by these tests.

## Analysis and transaction sync

Analysis is enabled for an active app-side Endute connection. The sidebar is disabled otherwise, direct navigation redirects to Accounts, and server procedures require the authenticated owner and an active connection. The page uses the existing table, with fixed newest-first order, 50 transactions per request, and First/Previous/Next navigation. Sorting and grouping are disabled for this paginated view to avoid misleading page-only analysis. No transactions are loaded into bootstrap. Account, description, merchant/counterparty, category, signed amount and currency appear in the table; all documented provider transaction fields are retained in storage.

The import includes all bank accounts enabled in the Endute portal, including currencies or types not selected for balance tracking. New connections register for scheduling atomically with the connection save. Existing connections register when the app next loads or Analysis is opened. Disconnect removes registration and stops access/import; existing imported data remains stored for reconnection.

Production uses an EventBridge Scheduler rate of five minutes and a private Lambda worker handler. A small registry of connected user IDs is queried in bounded pages and dispatched to separate user jobs. The runtime does not scan the table or copy API keys into job payloads. Local development runs the same dispatch every five minutes while the API process is running. Manual refresh runs a bounded batch immediately.

Initial import follows provider cursors through available history. Progress is persisted after each complete page. Accounts are visited round-robin, with a maximum of 10 pages per manual call or 80 pages/90 seconds per scheduled user job. Large histories therefore continue across runs. After backfill, imports revisit a seven-day overlap from the preceding read's start time, including when a read spans multiple runs. This catches late deliveries within that window; changes to older transactions require a future explicit full reconciliation feature.

A persisted 150-second lease serializes manual and background imports. Transaction writes condition on that lease token and the current encrypted key/connected state, preventing stale workers from writing after lease replacement, key rotation or disconnect. Partial page-write failures leave the provider cursor unchanged for safe replay. `Retry-After` is persisted and checked before another API call. Failures retain stored transactions and surface the error on Analysis.

Storage uses the same DynamoDB table with separate user-scoped partitions for date-ordered transactions, stable-ID pointers and sync state, plus a scheduling registry. Stable account/transaction IDs deduplicate imports; corrected booking dates move the chronological row atomically. Batch identity reads and bounded transactional writes avoid per-row lookup requests. Source fingerprints skip writes for unchanged transactions in overlapping polls. Reads use DynamoDB Query with an exclusive-start cursor and descending booking-date keys, without scans or loading the whole ledger. Pagination cursors are validated against the signed-in user's partition. Pagination is a live feed, so records added or corrected between page reads can change page boundaries.

The scheduler requires the deployment role's new scoped Scheduler permissions and permission to manage/pass its execution role. Apply the updated bootstrap configuration before deploying the application infrastructure. Unit tests cover provider paging and scheduler dispatch; DynamoDB tests cover replay, incremental windows, resumed backfills, date corrections, owner-scoped pagination, rate limits, leases, key replacement and disconnect. UI verification uses an isolated fixture server with synthetic transactions, not a production user session.
