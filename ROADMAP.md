# CourseSnag cloud roadmap

Last updated: 2026-08-10

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
- [x] Cloud-authoritative sign-in that replaces the browser watchlist instead of merging or uploading local trackers.
- [x] First-run Local/Cloud chooser and fixed-size mode settings.
- [x] Cloud availability gating and Local fallback.
- [x] Automatic switch from a saved Cloud selection to Local whenever Cloud is unavailable.
- [x] Automatic synchronization on load, refresh, add, and removal.
- [x] Unique seasonal alert identities so rapid OFFLINE/ONLINE rehearsals are not deduplicated by SQS.
- [x] Detailed owner status command with health, usage, queue, monitor, error, and budget summaries.
- [x] Persistent Discord application-description status synchronized by seasonal controls and deployments.
- [x] Discord callback and encrypted bot/client credentials.
- [x] Single-use OAuth state and immediate revocation of temporary Discord access tokens.
- [x] Discord-only account design using revocable, hashed 30-day CourseSnag sessions.
- [x] Tracker database write fixed by escaping DynamoDB's reserved `section` attribute.
- [x] Discord messages implemented for connection confirmation, open, closed/waitlisted, and idempotent seasonal ONLINE/OFFLINE transitions; add/remove messages intentionally suppressed.
- [x] API throttling enabled.
- [x] Private `/tracked` Discord command with signature verification and a ten-second per-user cooldown.
- [x] `/tracked` onboarding link for unlinked Discord users and unique linked-account operational counts.
- [x] Remove obsolete Google-era profile rows after confirming they had no dependent records.
- [x] Backend tests and CloudFormation validation passing.

## Current phase: live Discord verification

- [x] Discord callback registered in the Developer Portal.
- [x] Bot token and client secret stored as SSM `SecureString` values.
- [x] Identify why User Install did not deliver proactive DMs: Discord requires a mutual guild.
- [x] Add the CourseSnag bot and cloud-alert users to a shared Discord server.
- [x] Discord-only backend deployed to AWS.
- [x] Publish the matching Discord-only frontend through Cloudflare Pages and verify the production UI.
- [x] Complete one real Discord sign-in and verify the connected `jochu` account in production.
- [x] Deploy a confirmation DM after every successful Discord connection.
- [x] Verify the confirmation DM after the bot and tester share a server.
- [x] Add a test course and verify cloud persistence in the production browser and `/tracked`.
- [x] Receive and verify first availability-status DMs on tester account `jochu`.
- [x] Remove tracker-added and tracker-removed Discord messages from the product behavior.
- [x] Verify `/tracked` against the production watchlist and cooldown.
- [x] Verify notifier retries and dead-letter behavior; seven stale pre-fix test messages remain quarantined.
- [ ] Verify seasonal OFFLINE and ONLINE announcements during a full mode rehearsal.

## Later work

- [ ] Authorize an HTTP localhost origin in AWS CORS for local Cloud-mode UI testing; direct `file://` access remains Local-only.
- [ ] Add export/import backup for local watchlists.
- [ ] Add `/privacy` and `/terms` pages and configure their Discord URLs.
- [ ] Review policies before public use.
- [ ] Delete the seven stale pre-fix dead-letter messages after owner approval; do not replay them.
- [ ] Run a complete Cloud Active → Local Standby → Cloud Active rehearsal.

## Edge-case backlog

### High priority

- [x] Detect users who complete Discord OAuth without joining the shared server or allowing bot DMs; show actionable recovery instead of silently accepting a connection whose alerts cannot be delivered.
- [x] Record and surface Cornell group-level monitor failures so a partial Cornell outage cannot look like a fully healthy Lambda run.
- [x] Add an owner alarm for new dead-letter messages and define a safe inspect/delete workflow.
- [x] Prevent transition races: no course alert should arrive after OFFLINE, and ONLINE should precede the first resumed course alert.
- [x] Make `/tracked` state that monitoring is paused when CourseSnag is in Local Standby.

### Medium priority

- [ ] Make `start` and `stop` detect and repair drift between the SSM mode flag and EventBridge rule state.
- [ ] Decide whether a temporary API/network failure should persistently switch a browser from Cloud to Local or only fall back for that session.
- [ ] Handle missing Cornell sections and expired roster terms instead of leaving a tracker at a stale status indefinitely.
- [ ] Add DynamoDB point-in-time recovery or another small-data backup strategy before public use.
- [ ] Define and test the monitor's maximum roster/subject group count before its 55-second timeout requires batching.

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
