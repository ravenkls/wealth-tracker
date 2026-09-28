# Persistence and authentication design

Status: approved by the user, including local HTTP cookie exception and local AES-GCM credential encryption.

## Single-table records

Continue with the approved `pk` / `sk` string keys and `expiresAt` TTL. Use ElectroDB entities and no secondary indexes initially: each required list can be read from a known user partition or direct key. ElectroDB may add its own service/entity prefixes around these logical key patterns.

| Record                    | Partition                      | Sort key / access                                                        |
| ------------------------- | ------------------------------ | ------------------------------------------------------------------------ |
| User profile              | Google subject identity        | Profile; Google `sub` is the stable identity, not email                  |
| Manual account            | User                           | Account ID; query accounts by prefix                                     |
| Table preferences         | User                           | Table ID; conditional versions, column/row order, grouping and sorting   |
| Current budget/settings   | User                           | Budget; direct read                                                      |
| Trading 212 connection    | User                           | Provider account ID; prevents connecting the same account twice          |
| Active monthly snapshot   | User                           | Snapshot + `YYYY-MM`; ordered month queries                              |
| Snapshot revision         | User + month                   | Revision number; query revisions for one month                           |
| Completed save operation  | User                           | Operation UUID; saved result and payload digest                          |
| Application session       | SHA-256 of random opaque token | Session; direct read, expiration in epoch seconds                        |
| Short-lived OAuth attempt | SHA-256 of random state        | Attempt; browser-binding hash, nonce, PKCE verifier and 10-minute expiry |

All private data queries derive the user ID from the validated application session. API inputs never grant authority through a supplied user ID. Account definitions contain names, immutable kind (cash/pension), archive status, revision and an optional signed working balance. Existing records without a working balance require no migration: the UI falls back to the latest recorded account balance. Snapshot balances remain independent, immutable within a revision.

A snapshot replacement transaction checks the expected active revision, writes the new active value and immutable revision, and creates an operation record. Retrying a completed operation returns its original result; reusing its ID with different inputs is rejected. Operation receipts are retained without TTL initially so an old retry cannot replace a newer month. A racing create or stale edit returns a conflict without overwriting anything. Explicit historical corrections preserve provider values inside the old revision.

Account, budget and table-preference edits use conditional revision checks. Snapshot records store account names and component values as recorded. Archives/disconnections do not rewrite history.

## Google login and session lifecycle

- Backend authorization-code flow with state, browser-binding cookie, nonce and PKCE; request only `openid email profile`.
- Routes: `GET /auth/google`, `GET /auth/google/callback`, `POST /auth/logout`; user/session status through tRPC.
- Verify Google's signed ID token, issuer, audience, expiry, nonce and subject. Use the Google subject as identity. Do not retain Google access/refresh tokens.
- A random 256-bit opaque session cookie; only its SHA-256 digest is stored in DynamoDB. Cookie is host-only, Path=/, HttpOnly, SameSite=Lax, Secure in HTTPS environments.
- Check Origin against the configured app origin for mutations/logout. Do not enable cross-origin credentialed access.
- Each foreground authenticated request conditionally extends a still-valid session to 45 days from that request, with no maximum lifetime. Conditional checks prevent a concurrent logout from recreating a deleted session; concurrent renewals cannot shorten expiry. Background refetch/polling does not renew sessions.
- Logout deletes the current session immediately and clears the cookie. TTL cleanup is never used to determine whether a session is valid.
- OAuth attempts are consumed once, checked for expiry on read, and have TTL only for cleanup. The browser binding prevents a callback from a different browser being accepted.

## Local decisions

1. Approved local origin: `http://localhost:5173`, proxying `/auth` and `/api` to the host API. Use HttpOnly/SameSite=Lax with Secure disabled only on loopback HTTP during local development. The deployment cookie remains Secure.
2. Google Web application credentials are required in the ignored root `.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`). For the recommended local origin, add `http://localhost:5173/auth/google/callback` as an authorised redirect URI. No secret belongs in a `VITE_` variable or the browser bundle.
3. Local Trading 212 credentials: approved AES-256-GCM encryption using a separately generated key in the ignored root `.env`. Bind ciphertext to the user/account identity. Keep the encryption interface replaceable by the already-agreed KMS adapter when deployment is implemented. Never store provider secrets unencrypted in DynamoDB.

## Provider-history records

Cash events use a user/connection owner partition and a hash of source plus provider reference as their ID. Connection metadata stores transaction/dividend cursors, completion flags, refresh start/completion times and retry deadlines. Conditional version updates lease each bounded refresh step; paginated events can be safely re-read without duplication. Unknown transfers/distributions are not classified speculatively.

The [calculation rules](calculation-rules.md) record the approved UTC interval, London calendar, income/pension classification, missing-history and projection decisions. Net-worth saving is independent of history completion.

## Editable tables and autosave

TanStack Table supplies grouping, sorting and column ordering; MUI renders cells and dnd-kit provides keyboard/pointer drag handles. Preference records are keyed by a fixed table ID (accounts, connections, history, expenses, allocations), scoped to the authenticated user. They store only bounded arrays of IDs and sort descriptors.

Inline snapshot corrections accept a whitelisted field, expected revision and operation UUID. The backend reads the existing snapshot, rejects stale versions, keeps provider valuations/capture time frozen, recomputes totals and uses the same atomic revision/receipt transaction. Historical totals can be corrected irrespective of their month; creating a new manual historical entry still requires a past month. Whole-month replacement keeps its separate confirmation requirement.

Editing working balances never creates or changes a snapshot. The recording modal starts from working balances; edits made only inside that modal remain local until the explicit snapshot save and do not overwrite independently maintained working balances. Budget writes are serialised so rapid edits use the successful preceding version, while cross-tab conflicts stop further writes. Table cell edits retain the expected version from focus until commit.
