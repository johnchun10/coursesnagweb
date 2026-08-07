# CourseSnag cloud roadmap

Last updated: 2026-08-07

This file is the durable project checkpoint. Read it together with `docs/CLOUD_ARCHITECTURE.md` and `docs/OWNER_GUIDE.md` when resuming work in a new session.

## Product objective

Keep the existing Cloudflare Pages website available year-round while adding an optional AWS-backed Cloud Active mode for account-based tracking and Discord direct-message alerts.

The two operating modes are:

- **Local Standby:** the current browser tracker runs from Cloudflare Pages; the tab must remain open; the AWS monitor is disabled.
- **Cloud Active:** AWS checks cloud watchlists once per minute while the website is closed and sends Discord DMs when sections open.

## Fixed decisions

- Frontend hosting remains `https://coursesnag.pages.dev` on Cloudflare Pages.
- AWS region is `us-east-1`.
- AWS CLI uses the non-root SSO profile named `coursesnag`.
- Google is the CourseSnag account identity provider.
- Discord is connected separately and used for direct-message alerts.
- Discord application ID is `1534241192819163296`.
- AWS annual budget is USD 50.
- Cloud polling is shared and grouped by Cornell roster + subject, never one polling job per user.
- Cloud Active starts disabled after every initial deployment.
- Seasonal changes use one owner command rather than manual AWS Console edits.

## Completed

- [x] Existing static browser tracker inspected.
- [x] Existing website and visual changes preserved.
- [x] AWS CLI installed and configured.
- [x] IAM Identity Center user and `coursesnag` SSO profile configured.
- [x] Non-root AWS identity verified.
- [x] Google web OAuth client created with the Cloudflare Pages origin.
- [x] Discord application created.
- [x] Discord user `jochu` added as an application tester.
- [x] Secret files protected by `.gitignore`.
- [x] Cloud architecture and owner guide written.
- [x] Serverless backend handlers scaffolded.
- [x] CloudFormation/SAM infrastructure template scaffolded.
- [x] Seasonal `start`, `stop`, and `status` scripts created.
- [x] Discord secret-entry helper created.
- [x] Backend unit tests passing.
- [x] Backend dependency audit passing with no known vulnerabilities.
- [x] AWS accepted the infrastructure template during validation.
- [x] Budget alert email configured locally.
- [x] First CloudFormation attempt safely rolled back after exposing the account's minimum Lambda concurrency quota.
- [x] Unsupported reserved concurrency removed; the 55-second timeout remains below the one-minute schedule interval.
- [x] DynamoDB rollback policy improved to delete newly created empty tables while retaining established account data.

## Safe foundation deployment: complete

Deployed stack: `coursesnag-dev`

API base URL:

```text
https://ysc5mgv0ne.execute-api.us-east-1.amazonaws.com/dev
```

Deployment should create the following resources while leaving monitoring disabled:

- API Gateway HTTP API
- API Lambda
- Monitor Lambda
- Discord notifier Lambda
- Owner-operations Lambda
- DynamoDB account/watchlist table
- EventBridge once-per-minute rule in `DISABLED` state
- FIFO alert queue and dead-letter queue
- SSM mode parameter set to `local`
- Seven-day CloudWatch log groups
- USD 50 annual AWS budget notifications
- Private deployment-artifact S3 bucket with 30-day expiration

Post-deployment checks:

- [x] CloudFormation stack reaches `CREATE_COMPLETE`.
- [x] Public `/health` endpoint returns HTTP 200.
- [x] Public `/mode` endpoint returns `local`.
- [x] API permits the Cloudflare origin through CORS.
- [x] Private `/trackers` route rejects unauthenticated requests with HTTP 401.
- [x] `./scripts/season.sh status` reports `Mode: local`.
- [x] `./scripts/season.sh status` reports `Monitor rule: DISABLED`.
- [x] AWS Budget exists with USD 50 annual limit.
- [x] Budget notifications exist at 20%, 50%, 80%, and 100%.
- [x] Alert queue is empty after deployment.
- [x] Monitor has no log stream, confirming it has not been invoked.

## Current phase: account and watchlist integration

- [x] Add Sign in with Google to the Cloudflare frontend.
- [x] Send Google ID tokens to the protected AWS API.
- [x] Create/update the CourseSnag profile after sign-in.
- [x] Synchronize the browser-local watchlist to the cloud account.
- [x] Keep local browser storage updated whenever cloud trackers change.
- [x] Preserve local removals as sync tombstones so stale cloud trackers do not reappear.
- [x] Keep the browser watchlist intact on sign-out and cloud/API failure.
- [x] Display Local Standby versus Cloud Active clearly in the website.
- [x] Move alert, refresh, and cloud controls into one first-run onboarding/settings dialog.
- [x] Make onboarding choose Local or Cloud before showing mode-specific controls.
- [x] Keep onboarding and mode settings in one fixed-size dialog.
- [x] Require an explicit Continue action after selecting a mode.
- [x] Persist the user's alert mode between visits.
- [x] Open Settings directly to the active mode and provide a dedicated switch-mode action.
- [x] Disable Cloud selection unless AWS reports Cloud Active.
- [x] Mark Cloud setup as requiring Discord.
- [x] Keep the main tracker focused on search and watchlist content.
- [x] Add a persistent Settings entry point to the bottom frame.
- [x] Request browser notification permission only after the user enables it.
- [x] Verify local search, add, persistence, removal, desktop layout, and mobile layout.
- [x] Verify cloud-to-local merging with an isolated mocked Google session and API.
- [x] Publish the frontend changes to Cloudflare Pages.
- [x] Complete one real Google sign-in and AWS account/watchlist round trip at `coursesnag.pages.dev`.
- [x] Sync account watchlists automatically on page load, refresh, add, and removal.
- [x] Present Google and Discord as parallel account connections in Cloud settings.
- [ ] Authorize an HTTP localhost origin in Google and AWS CORS for local Cloud-mode UI testing; direct `file://` access remains Local-only.
- [ ] Add export/import backup for local watchlists.

## Discord phase

- [x] Implement Discord OAuth connect, callback, status, and disconnect code locally.
- [x] Protect callbacks with ten-minute, single-use OAuth state records.
- [x] Limit Discord authorization to `identify` and avoid retaining user access tokens.
- [x] Deploy Discord OAuth routes to AWS.
- [ ] Add the deployed callback URL in the Discord Developer Portal.
- [ ] Store the bot token and OAuth client secret with `./scripts/set-discord-secrets.sh`.
- [ ] Persist the authorized Discord user ID on the matching Google profile.
- [ ] Send a test DM to tester account `jochu`.
- [ ] Verify alert retries and dead-letter behavior.
- [ ] Verify seasonal shutdown announcement.

The bot token and OAuth client secret must never be committed or pasted into chat.

## Production-readiness phase

- [ ] Add `/privacy` and `/terms` pages to Cloudflare Pages.
- [ ] Add the policy URLs to Discord and Google configuration.
- [ ] Review policies before public use.
- [ ] Add API throttling and abuse tests.
- [ ] Confirm Cornell polling cadence and batching behavior under realistic load.
- [ ] Expand the status command with API health, last monitor result, queue depth, errors, tracker count, and cost information.
- [ ] Run a complete Cloud Active to Local Standby rehearsal.

## Owner commands

```bash
aws sso login --profile coursesnag
./scripts/deploy.sh
./scripts/season.sh status
./scripts/season.sh start
./scripts/season.sh stop
./scripts/set-discord-secrets.sh
```

Do not manually delete or disable individual AWS resources during normal seasonal operation. Use `season.sh` so the mode flag and monitor rule stay consistent.

## Resume checklist

1. Read this file and `docs/CLOUD_ARCHITECTURE.md`.
2. Run `git status --short` and preserve unrelated user changes.
3. Run `aws sso login --profile coursesnag` if the temporary session expired.
4. Run `./scripts/season.sh status` if the stack has been deployed.
5. Continue from the first unchecked item in the current phase.
