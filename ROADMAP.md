# CourseSnag cloud roadmap

Last updated: 2026-08-07

This is the durable project checkpoint. Read it with `docs/CLOUD_ARCHITECTURE.md` and `docs/OWNER_GUIDE.md` when resuming in a new session.

## Product objective

Keep the Cloudflare Pages tracker available year-round in Local Standby, and manually enable a low-cost AWS Cloud Active mode around enrollment periods. Cloud Active synchronizes watchlists to a Discord-owned account, monitors while computers are off, and sends Discord direct messages.

## Fixed decisions

- Frontend remains `https://coursesnag.pages.dev` on Cloudflare Pages.
- AWS region is `us-east-1`; CLI profile is `coursesnag`; stack is `coursesnag-dev`.
- Discord is the only cloud identity and alert destination.
- Discord application ID is `1534241192819163296`.
- Cloud polling runs once per minute and is grouped by Cornell roster + subject.
- Seasonal state is changed with `scripts/season.sh`, not by editing separate AWS resources.
- Annual AWS budget is USD 50.

## Completed foundation

- [x] Static local tracker and Local Standby mode.
- [x] Cloudflare Pages GitHub deployment.
- [x] AWS SSO CLI profile using a non-root role.
- [x] Serverless API, monitor, notifier, owner-operations Lambda, DynamoDB, SQS/DLQ, EventBridge, SSM mode flag, logs, artifact bucket, and budget.
- [x] `start`, `stop`, and `status` seasonal controls.
- [x] Browser-local/cloud merge and deletion tombstones.
- [x] First-run Local/Cloud chooser and fixed-size mode settings.
- [x] Cloud availability gating and Local fallback.
- [x] Automatic synchronization on load, refresh, add, and removal.
- [x] Discord callback and encrypted bot/client credentials.
- [x] Single-use OAuth state and immediate revocation of temporary Discord access tokens.
- [x] Discord-only account design using revocable, hashed 30-day CourseSnag sessions.
- [x] Tracker database write fixed by escaping DynamoDB's reserved `section` attribute.
- [x] Discord messages implemented for tracker added, tracker removed, open, closed/waitlisted, and seasonal shutdown.
- [x] API throttling enabled.
- [x] Backend tests and CloudFormation validation passing.

## Current phase: live Discord verification

- [x] Discord callback registered in the Developer Portal.
- [x] Bot token and client secret stored as SSM `SecureString` values.
- [x] Discord User Install enabled with `applications.commands`.
- [x] Discord-only backend deployed to AWS.
- [ ] Publish the matching Discord-only frontend through Cloudflare Pages.
- [ ] Complete one real Discord sign-in and verify the same account returns after refresh.
- [ ] Add a test course and verify cloud persistence.
- [ ] Receive “tracking added” and first availability-status DMs on tester account `jochu`.
- [ ] Remove the course and receive “tracking stopped.”
- [ ] Verify notifier retries and dead-letter behavior.
- [ ] Verify seasonal shutdown announcement.

## Later work

- [ ] Authorize an HTTP localhost origin in AWS CORS for local Cloud-mode UI testing; direct `file://` access remains Local-only.
- [ ] Add export/import backup for local watchlists.
- [ ] Add `/privacy` and `/terms` pages and configure their Discord URLs.
- [ ] Review policies before public use.
- [ ] Expand `season.sh status` with API health, last monitor result, queue depth, tracker count, errors, and cost information.
- [ ] Run a complete Cloud Active → Local Standby → Cloud Active rehearsal.

## Owner commands

```bash
aws sso login --profile coursesnag
./scripts/deploy.sh
./scripts/season.sh status
./scripts/season.sh start
./scripts/season.sh stop
./scripts/set-discord-secrets.sh
```

## Resume checklist

1. Read this file and `docs/CLOUD_ARCHITECTURE.md`.
2. Run `git status --short` and preserve unrelated changes.
3. Run `aws sso login --profile coursesnag` if the temporary session expired.
4. Run `./scripts/season.sh status`.
5. Continue from the first unchecked item in the current phase.
