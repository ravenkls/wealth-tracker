# Production deployment

Live app: https://wealth.kristiansmith.dev. Source: https://github.com/ravenkls/wealth-tracker.

AWS account `235607286117`, region `eu-west-2`. CloudFront's ACM certificate is in `us-east-1`. The existing `kristiansmith.dev` Route 53 zone supplies DNS.

## Runtime

- Private S3 assets behind CloudFront with origin access control and an extensionless-path SPA rewrite.
- `/api/*` and `/auth/*` route uncached to HTTP API Gateway and one ARM64 Node 24 Lambda.
- One on-demand DynamoDB table with `pk`/`sk`, `expiresAt` TTL, point-in-time recovery and deletion protection.
- One rotating KMS key for Trading 212 credentials. Ciphertext is bound to the user/connection using encryption context.
- Google OAuth configuration in Secrets Manager, loaded on cold start. No secrets in Terraform state, Lambda environment variables, browser bundles or GitHub secrets.
- HttpOnly, Secure, SameSite=Lax session cookies. Both API mutations and logout validate the public origin.
- CloudWatch Lambda/API logs retained for 14 days. Request logs omit URLs, bodies, cookies and credentials. API throttling is 20 requests/second with a 40-request burst.

## Bootstrap (administrator, once)

Use an AWS profile with permission to create the state bucket, lock table and GitHub OIDC role. The existing GitHub OIDC provider is reused. Bootstrap is separate from CI so the pipeline cannot alter its own trust configuration through Terraform.

```sh
AWS_PROFILE=kristian terraform -chdir=infra/bootstrap init
AWS_PROFILE=kristian terraform -chdir=infra/bootstrap plan -out=bootstrap.tfplan
AWS_PROFILE=kristian terraform -chdir=infra/bootstrap apply bootstrap.tfplan
AWS_PROFILE=kristian aws s3 cp infra/bootstrap/terraform.tfstate s3://wealth-tracker-terraform-235607286117/bootstrap/terraform.tfstate.backup --sse AES256
```

Bootstrap state remains local and ignored; preserve its encrypted S3 backup. On a new workstation download that backup to `infra/bootstrap/terraform.tfstate` before changing bootstrap. Never initialize a second unmanaged copy of these resources.

The deployment role trusts only this repository's `main` branch, accepting both GitHub subject formats. AWS credentials are issued per job through OIDC. No AWS access keys are stored in GitHub.

## CI/CD

Pull requests and main pushes run formatting, lint, TypeScript, unit tests, API/web builds, DynamoDB integration tests and Terraform validation/security assertions. Main then builds the deployable zip, applies the reviewed-in-source Terraform configuration, publishes assets before index.html, invalidates CloudFront and checks the public site, API health and anonymous session response. Concurrent production runs are serialized.

Terraform state is encrypted/versioned in S3 and locked using DynamoDB. Provider versions and checksums are committed. The pipeline retains older hashed frontend assets so open clients survive a deployment. To roll back application code, revert the offending commit and let main deploy; do not roll back the database or delete Terraform state.

The first deployment creates an empty Google secret resource. Seed it using the operator command below before smoke checks can pass. This command uses the existing ignored `.env` and sends only Google client credentials to Secrets Manager; it never prints their values.

```sh
AWS_PROFILE=kristian pnpm --filter @wealth/api ops seed-google
```

Register `https://wealth.kristiansmith.dev/auth/google/callback` with that Google client. Keep the localhost redirect for development. Google Cloud's publishing/test-user settings still govern who can authorize that client.

## One-time local data migration

Stop editing the local app during the copy. The operator command takes a private local backup, requires exactly one local profile, copies that user's records while preserving keys and revisions, and excludes sessions/OAuth attempts. Trading 212 credentials are decrypted only in memory and re-encrypted with KMS. Existing differing production records are never overwritten. Retries compare existing records, including decrypted credentials, so a partially completed copy can resume safely. The local database is unchanged.

```sh
AWS_PROFILE=kristian pnpm --filter @wealth/api ops migrate
```

Migration logs report entity counts, never balances or credentials. Backups are under the ignored `.private/` directory with owner-only permissions. After migration, use the production app as the source of truth; local and production databases do not synchronize.

## Operations

Run `pnpm build` before Terraform plan/validate because the Lambda zip hash is part of the plan. Use `AWS_PROFILE=kristian terraform -chdir=infra init` to access the remote production state locally. Never run apply concurrently with CI.

If health fails, check `/aws/lambda/wealth-tracker-production` and `/aws/apigateway/wealth-tracker-production` in CloudWatch. Rotate Google credentials by updating the secret then recycling Lambda configuration; warm runtimes cache the secret. KMS rotation retains decryption of existing credentials. Losing or deleting the KMS key prevents decryption, so the key and data table are protected from Terraform destruction.

DynamoDB point-in-time recovery restores into a new table. A restore requires a deliberate cutover of the Lambda table setting and Terraform state, not an in-place overwrite. No scheduled workers or extra cloud services are required for the app's resumable Trading 212 refresh.
