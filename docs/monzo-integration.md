# Monzo automated tracking

Users connect their own confidential Monzo OAuth client. The server exchanges authorization codes and renews access; client secrets and tokens never appear in bootstrap responses. Each client must register the exact callback for its environment:

- Production: `https://wealth.kristiansmith.dev/auth/monzo/callback`
- Local development: `http://localhost:5173/auth/monzo/callback`

Monzo's [Developer API documentation](https://docs.monzo.com/) describes personal/explicitly allowed usage rather than general public applications. Supplying individual clients is technically supported by this implementation, but is not an endorsement by Monzo of this distribution model. Actual product coverage must be checked against the returned accounts and pots; Flex, investments and products absent from the response remain manual.

## Connection and account lifecycle

1. Accounts → Connect Monzo accepts the user's client ID and secret and redirects to Monzo.
2. The callback requires the same authenticated application session. After the user approves access in Monzo's mobile app, Load balances fetches current accounts and pots.
3. Users select individual balances. Each becomes a new cash account under Automated tracking accounts. Existing manual accounts are not matched, modified or archived automatically. The selection screen reminds users to archive duplicates.
4. Refresh reads each current account's `balance` and active pots' individual `balance` values, in GBP pence. It does not add `total_balance`, which already includes pots. Unknown product types are excluded.
5. A complete successful response updates working balances and names by stable remote IDs, and automatically archives selected accounts/pots that are closed, deleted or absent. Incomplete responses and API errors do not archive accounts or replace balances with zero.
6. Save selection archives deselected automated accounts. Re-selecting an existing automated account restores its identity. Disconnect converts its accounts to manual, preserves their archive state, last balances, snapshot history and budget destinations, and removes stored credentials. Remote revocation is attempted; local disconnection still completes if Monzo is unavailable.

## Snapshots and calculations

Record snapshot fetches selected Monzo connections and Trading 212 concurrently. Any required refresh failure prevents the snapshot save. Newly missing Monzo balances are archived and omitted from that snapshot. Their old readings remain in history. Manual input never supplies or overrides automated values.

Saved bank readings retain provider, connection, external ID and fetch time. Corrections preserve them. Cash savings calculations continue to use cash balance changes; this feature does not import bank transactions or alter the existing income treatment. Changing the tracked account set makes the affected savings interval unavailable under the existing coverage checks. In particular, creating new Monzo accounts in place of manual accounts does not silently claim historical continuity.

## Storage and security

- `bankConnection` records are user-scoped ElectroDB entities in the existing table. Existing Trading 212 records keep their schema.
- Account records gain optional `automation` metadata. Snapshot balance rows gain optional immutable automation provenance. Existing records need no migration.
- `monzoOAuth` attempts contain hashed random state, user/session binding, encrypted client credentials and a ten-minute expiry checked on consumption. DynamoDB TTL cleans up abandoned attempts. Conditional deletion permits exactly one valid callback.
- The existing encryption abstraction uses KMS in production and AES-GCM locally, with a user/connection-specific encryption context. Callback attempts have a separate context.
- Monzo connection updates use optimistic versions. A persisted lease serializes refreshes across Lambda instances. A one-use refresh grant is marked in progress before the request. Ambiguous failures require reconnection; successful replacement tokens are persisted before reading balances.
- Balance and account-selection changes commit atomically with the connection version. Account limits keep writes within DynamoDB transaction limits.
- API requests use fixed Monzo origins, request timeouts, no redirects and safe error messages. The app only calls balance/account/pot reads and OAuth endpoints, never transfer or payment endpoints.
- Foreground connection mutations require the application's authenticated session and same-origin protection. OAuth responses use no-store and no-referrer headers.

## Verification

Provider tests cover token exchange/rotation, nonrenewable credentials, main/pot double counting, deleted pots, partial responses and safe errors. DynamoDB integration tests cover OAuth binding/expiry/replay, secret isolation, concurrent and ambiguous refreshes, selection, archive/disconnect behavior, snapshot failure blocking and immutable recorded bank values.

A real confidential-client authorization and comparison of returned balances with Monzo remains the final end-to-end check.
