# Wealth Tracker

A personal-finance app built with React, MUI, TanStack Table, Recharts, tRPC and ElectroDB. Track signed cash balances, manual pensions, Trading 212 holdings, monthly net worth, budgeting and savings goals. Deployed at [wealth.kristiansmith.dev](https://wealth.kristiansmith.dev) with Terraform and GitHub Actions. See [deployment and operations](infra/README.md).

## Run locally

Requires Node **24.21.0** (Node 24 LTS), pnpm **10.24.0**, and Docker with Compose. Both `.nvmrc` and `.node-version` pin the repo runtime. With nvm, `nvm use` selects it for the current shell without changing your global default.

```sh
nvm use
pnpm install --frozen-lockfile
pnpm dev:setup
```

Configure the ignored root `.env`:

- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`: a Google OAuth Web application client with `http://localhost:5173/auth/google/callback` registered as an authorised redirect URI.
- `LOCAL_ENCRYPTION_KEY`: a random 32-byte key, base64 encoded. Generate once with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` and put it in `.env`. Keep this key: changing it makes existing Trading 212 credentials unreadable until reconnected.

Then run:

```sh
pnpm dev
```

Open **[http://localhost:5173](http://localhost:5173)** and sign in with Google. There is no development authentication bypass. Add cash/pension accounts under Accounts; optionally connect Trading 212 with read-only account, positions, transactions and dividend permissions. Invest and Stocks ISA are supported. The account must report GBP.

React and the API run on the host. Only DynamoDB runs in Docker, bound to loopback with a persistent named volume. `dev:setup` creates `.env` if missing and initialises or validates the single table; re-running it preserves existing data and configuration. The local API rejects production mode and non-loopback database endpoints.

## App behaviour

- **Overview** displays saved balances and monthly history, never a mixture of saved cash and freshly priced investments.
- **Accounts** manages generic cash/debt and pension accounts with inline autosaved names/working balances, Trading 212 connections and current holdings. Enter debts as negative cash balances. Archiving or disconnecting preserves history.
- **Budget** autosaves valid edits and contains pay-frequency conversion, monthly/annual expenses, saving allocations, account funding instructions, the dynamic cash/investment split and goal settings. It never moves money.
- **Record snapshot** opens a modal. One action fetches connected investments and saves the current London calendar month. Failed valuations block saving and retain the form for retry. Replacing a saved month requires confirmation and retains its previous revision.
- **History** supports past monthly totals, inline autosaved corrections and revision inspection. Corrections preserve captured investment values. Stale writes are rejected, and identical snapshot retries return their original result.
- **Savings estimates** use actual UTC intervals between recorded balance readings, confirmed income and complete Trading 212 cash history. Pensions are excluded from the savings rate; pension payments from cash are removed from inferred spending. Missing or ambiguous inputs produce unavailable metrics, never invented zero flows. Manual historical totals cannot establish an interval.
- **Tables** support grouping, sorting and draggable columns. Accounts and budget rows can be dragged when grouping/sorting is cleared; History stays sortable by month/value. Table preferences sync to your account. Text/money cells commit on blur or Enter; Escape cancels. Working balances remain separate from recorded monthly net worth.
- **History refresh** advances in bounded, rate-limited requests while the app is visible. Closing the app pauses it; reopening resumes from saved cursors. It does not keep the login session alive.

The development panel offers an explicitly labelled sample dashboard. Sample data does not enter the database; preview modules are excluded from production builds.

## Commands

| Command                          | Purpose                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------- |
| `pnpm dev`                       | Start Vite and API with reload                                                  |
| `pnpm dev:setup`                 | Initialise environment, container and table without resetting data              |
| `pnpm db:up` / `pnpm db:down`    | Start/stop DynamoDB; preserve its volume                                        |
| `pnpm db:init` / `pnpm db:check` | Initialise/validate or check the table                                          |
| `pnpm check`                     | Format, lint, type checks, unit tests and frontend and Lambda production builds |
| `pnpm test:integration`          | DynamoDB integration tests in a disposable test table                           |
| `pnpm test:watch`                | Watch unit tests                                                                |
| `pnpm format` / `pnpm lint:fix`  | Apply formatting/lint fixes                                                     |

## Architecture

```text
apps/web/          React routes, MUI forms, Recharts, typed tRPC client
apps/api/          Authentication, application services, provider adapter, ElectroDB storage
packages/domain/   GBP, monthly history, budget, savings and projection calculations
scripts/           Local setup and integration-test runner
tooling/           DynamoDB Local image with a writable non-root data directory
docs/              PRD, PlantUML diagrams, implementation notes and approved mockups
```

The domain package imports neither React, tRPC nor AWS. Services receive their storage/provider/cipher dependencies at the API entry point. The browser imports only the API type contract. Credentials and server code stay out of the client bundle.

Vite proxies `/api/*` and `/auth/*` to the backend on the same browser origin. Sessions use an opaque HttpOnly/SameSite=Lax cookie and a hashed DynamoDB record, renewed conditionally for 45 days on foreground activity with no maximum lifetime. Logout deletes the session. Local loopback HTTP is the approved exception to the deployment's Secure-cookie requirement. Trading 212 credentials are encrypted with AES-256-GCM and bound to the user/account; production uses KMS.

Ports and table name can be changed in `.env`; update the Google callback URI if changing the web port. Defaults: web `5173`, API `3001`, DynamoDB `8000`, table `wealth-tracker-local`.

## Verification and troubleshooting

`pnpm check` needs no Docker or external credentials. Integration tests require DynamoDB Local and create/delete only their own randomly named table. Tests cover decimal-safe amounts, spreadsheet allocation rules, irregular savings intervals, provider validation, session expiry/revocation, OAuth attempt replay prevention, user isolation, atomic revisions, idempotent retries, frozen corrections and resumable history.

For startup failures, use `docker compose ps -a` and `docker compose logs dynamodb`. Port conflicts fail explicitly. Incompatible table keys/capacity/TTL are rejected, never silently replaced. There is no data-reset command. Never commit `.env` or put secrets in `VITE_` variables.

See [implementation status](docs/implementation-status.md), [PRD and architecture diagrams](docs/PRD.md), [persistence/auth design](docs/persistence-and-auth-design.md) and [financial calculation rules](docs/calculation-rules.md).
