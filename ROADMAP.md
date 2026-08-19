# CourseSnag Discord roadmap

Last updated: 2026-08-17

This is the durable project checkpoint. Read it with `docs/CLOUD_ARCHITECTURE.md` and `docs/OWNER_GUIDE.md` when resuming in a new session.

## Product objective

Keep the Cloudflare Pages tracker available year-round in Local Standby, and manually enable a low-cost AWS Discord Active mode around enrollment periods. Discord Active synchronizes watchlists to a Discord-owned account, monitors while computers are off, and sends Discord direct messages.

## Fixed decisions

- Frontend remains `https://coursesnag.pages.dev` on Cloudflare Pages.
- AWS region is `us-east-1`; CLI profile is `coursesnag`; stack is `coursesnag-dev`.
- Discord is the only server-backed identity and alert destination.
- Discord application ID is `1534241192819163296`.
- The stable internal mode value remains `cloud` for compatibility; the product and owner-facing name is **Discord Active**.
- Discord monitoring is grouped by Cornell roster + subject and targets half of Cornell's published class-status refresh interval in `America/New_York` time.
- Seasonal state is changed with `scripts/season.sh`, not by editing separate AWS resources.
- Annual AWS budget is USD 50.

## Completed foundation

- [x] Static local tracker and Local Standby mode.
- [x] Cloudflare Pages GitHub deployment.
- [x] AWS SSO CLI profile using a non-root role.
- [x] Serverless API, monitor, notifier, owner-operations Lambda, DynamoDB, SQS/DLQ, EventBridge, SSM mode flag, logs, artifact bucket, and budget.
- [x] `start`, `stop`, and `status` seasonal controls.
- [x] Discord-authoritative sign-in that replaces the browser watchlist instead of merging or uploading local trackers.
- [x] First-run Browser/Discord chooser and fixed-size mode settings.
- [x] Discord availability gating and Local fallback.
- [x] Automatic switch from a saved Discord selection to Local whenever Discord monitoring is unavailable.
- [x] Automatic synchronization on load, refresh, add, and removal.
- [x] Unique seasonal alert identities so rapid OFFLINE/ONLINE rehearsals are not deduplicated by SQS.
- [x] Detailed owner status command with health, usage, queue, monitor, error, and budget summaries.
- [x] Private CloudWatch operations dashboard for API, Discord, monitor, queue, latency, and recent delivery activity.
- [x] Daily active users measured as unique linked users making authenticated Discord-service requests in the previous 24 hours.
- [x] Persistent Discord application-description status synchronized by seasonal controls and deployments.
- [x] Discord callback and encrypted bot/client credentials.
- [x] Single-use OAuth state and immediate revocation of temporary Discord access tokens.
- [x] Discord-only account design using revocable, hashed 30-day CourseSnag sessions.
- [x] Tracker database write fixed by escaping DynamoDB's reserved `section` attribute.
- [x] Discord messages implemented for connection confirmation, open, closed/waitlisted, and idempotent seasonal ONLINE/OFFLINE transitions; add/remove messages intentionally suppressed.
- [x] API throttling enabled.
- [x] Private `/tracked` Discord command with signature verification and a ten-second per-user cooldown.
- [x] Remove `/tracked` and hard-disable the website and interaction Lambdas in Local Standby; restore them in Discord Active.
- [x] `/tracked` onboarding link for unlinked Discord users and unique linked-account operational counts.
- [x] Remove obsolete Google-era profile rows after confirming they had no dependent records.
- [x] Backend tests and CloudFormation validation passing.
- [x] Full Discord Active → Local Standby → Discord Active rehearsal with both seasonal Discord announcements.
- [x] Exact-origin localhost Discord testing, including a localhost-aware Discord OAuth return.
- [x] Public Privacy Policy and Terms of Service pages linked from the tracker.

## Current phase: live Discord verification

- [x] Discord callback registered in the Developer Portal.
- [x] Bot token and client secret stored as SSM `SecureString` values.
- [x] Identify why User Install did not deliver proactive DMs: Discord requires a mutual guild.
- [x] Add the CourseSnag bot and Discord Alerts users to a shared Discord server.
- [x] Discord-only backend deployed to AWS.
- [x] Publish the matching Discord-only frontend through Cloudflare Pages and verify the production UI.
- [x] Publish and configure live Privacy Policy and Terms of Service URLs in Discord.
- [x] Complete one real Discord sign-in and verify the connected `jochu` account in production.
- [x] Deploy a confirmation DM after every successful Discord connection.
- [x] Verify the confirmation DM after the bot and tester share a server.
- [x] Add a test course and verify Discord watchlist persistence in the production browser and `/tracked`.
- [x] Receive and verify first availability-status DMs on tester account `jochu`.
- [x] Remove tracker-added and tracker-removed Discord messages from the product behavior.
- [x] Verify `/tracked` against the production watchlist and cooldown.
- [x] Verify notifier retries and dead-letter behavior; the dead-letter queue is currently empty.
- [x] Verify seasonal OFFLINE and ONLINE announcements during a full mode rehearsal.
- [x] Combine Discord identity linking and zero-permission server installation into one guided OAuth onboarding flow.

## Later work

- [x] Authorize an HTTP localhost origin in AWS CORS for local Discord-mode UI testing; direct `file://` access remains Local-only.
- [x] Add Privacy Policy and Terms of Service pages.
- [x] Configure the production Privacy Policy and Terms URLs in Discord.
- [ ] Review policies before public use.
- [ ] Complete team-owner identity verification only when preparing for formal Discord app verification or scaling beyond 100 servers.
- [x] Run a complete Discord Active → Local Standby → Discord Active rehearsal.

## Approved product roadmap

The phases below record the agreed direction from the CourseGrab comparison and the August 17 planning discussion. They are not descriptions of currently deployed behavior.

### Phase 1: adaptive Cornell polling and monitor reliability

Cornell's [Class Roster FAQ](https://classes.cornell.edu/content/FA26/faq) says open, closed, and waitlist status is refreshed on this schedule. CourseSnag will poll at half of each published interval to tolerate an unknown refresh phase:

| New York time | Cornell's published refresh | CourseSnag target |
| --- | ---: | ---: |
| 06:00–16:59 | Every 10 minutes | Every 5 minutes |
| 17:00–23:59 | Every 20 minutes | Every 10 minutes |
| 00:00–05:59 | Every 60 minutes | Every 30 minutes |

- [x] Replace the fixed one-minute Cornell polling behavior with a five-minute scheduler tick and the time-window guard above. All boundaries use `America/New_York`, including daylight-saving transitions.
- [x] Queue one immediate cycle when Discord Active starts, then follow the applicable interval.
- [x] Preserve Cornell's limit of no more than one API request per second while continuing to group trackers by roster + subject.
- [x] Add a DynamoDB lease/schedule guard so overlapping invocations cannot duplicate monitor work.
- [x] Queue and commit each completed subject group incrementally instead of waiting for the entire scan.
- [x] Rotate the next run after a partial scan so later subjects cannot starve, and raise the Lambda timeout to five minutes.
- [x] Use deterministic transition identities so a retry of the same transition keeps the same SQS deduplication identity.
- [x] Record source-observed, detected, queued, and Discord-accepted timestamps in structured logs.
- [x] Test interval boundaries, daylight-saving changes, scheduling decisions, and partial-run group rotation.
- [ ] Deploy and rehearse Discord Active start/stop, forced first polling, a partial Cornell failure, and production alert-latency logging.
- [ ] Establish a measured p95 alert-latency target before advertising CourseSnag as faster than another service.

The target measures latency after Cornell publishes a change. Cornell notes that Student Center remains the most current source, so CourseSnag must not market these alerts as real-time registration data.

### Phase 2: course-name and course-code search

- [x] Accept course titles and codes with or without spaces, while preserving the existing fast subject/code path.
- [x] Use Cornell's supported class-search query parameter and include all current instruction modes so a title query can span subjects in one rate-limited request.
- [x] Rank exact course-code matches first, then title-prefix and token matches; cap results at 25.
- [x] Preserve debouncing, request cancellation, client caching, and Cornell's one-request-per-second limit.
- [x] Verify ordinary title search and exact code search against the live Fall 2026 API in a real browser.
- [ ] Add a prebuilt roster search index only if direct Cornell search proves too slow or insufficiently typo-tolerant.

### Phase 3: section watcher counts

- [x] Show an aggregate section-level count, matching the unit users actually track and avoiding double-counting a person across a course's sections.
- [x] Label the value **Discord watchers**, because Local-mode watchlists never leave the browser and cannot be counted accurately.
- [x] Derive counts from the existing active-tracker GSI with paginated queries and distinct user aggregation; return no user identifiers.
- [x] Cache responses for 30 seconds, throttle the public endpoint, request counts only for tracked cards, and hide them when Discord monitoring is unavailable.
- [x] Show counts only in **Tracked classes** after a user chooses to track a section; keep search-result rows count-free.
- [x] Verify tracked-card count rendering and mobile layout with a mocked aggregate response.
- [ ] Add a maintained counter/index only if measured traffic makes derived counts too expensive; pair any counter with transactional writes and reconciliation to prevent drift.

### Phase 4: canceled mobile expansion; Student Center handoff retained

The previously proposed PWA/Web Push and other mobile-alert expansion work is canceled. Existing in-browser notifications remain a Browser Alerts feature; CourseSnag will not add background browser push to Discord Alerts.

- [x] Add **Open Student Center** to the in-browser open-section alert.
- [ ] Production-check the Student Center redirect after publishing.

### Phase 5: Student Center assisted/automatic enrollment discovery (deferred)

Goal: investigate whether a user can sign in to Student Center and have CourseSnag attempt enrollment when a tracked section opens. This is a research proposal only; no credential collection, browser automation, or enrollment submission is authorized by this roadmap entry.

- [ ] Confirm Cornell's acceptable-use, registration, security, and automation rules, and obtain any required written authorization before building or testing enrollment automation.
- [ ] With the owner present, map the signed-in enrollment flow read-only: authentication/MFA, course selection, cart, confirmation, result states, session expiry, and anti-automation controls. Do not record credentials or submit a real enrollment during discovery.
- [ ] Prefer a user-controlled authenticated browser session. Do not send a NetID password, MFA secret, session cookie, or reusable Student Center token to the CourseSnag backend.
- [ ] Compare three product levels: a deep link and guided handoff; a user-confirmed local enrollment assistant; and fully automatic background enrollment. Choose the least-privileged level Cornell explicitly permits.
- [ ] Threat-model account takeover, session theft, unintended enrollment, duplicate attempts, and compromised CourseSnag infrastructure before prototyping.
- [ ] Define behavior for prerequisites, permission numbers, holds, time conflicts, credit limits, linked lecture/discussion choices, waitlists, swaps, full sections, expired sessions, and ambiguous Student Center responses.
- [ ] Require explicit per-section consent, an attempt expiry, idempotency, audit history, an emergency kill switch, and a clear statement that enrollment is never guaranteed.
- [ ] Never drop, swap, or alter another class unless the user separately and explicitly authorizes that exact action.
- [ ] Prototype only in an approved non-destructive or sandbox flow. A limited opt-in beta and independent security review are required before any production enrollment action.

The initial discovery deliverable should be a feasibility report and sequence diagram, not enrollment code. If Cornell does not permit automation, Phase 5 stops at the guided Student Center handoff from Phase 4.

## Edge-case backlog

### High priority

- [x] Install the bot into a user-selected server during Discord OAuth and show actionable recovery when the confirmation DM is blocked.
- [x] Record and surface Cornell group-level monitor failures so a partial Cornell outage cannot look like a fully healthy Lambda run.
- [x] Add an owner alarm for new dead-letter messages and define a safe inspect/delete workflow.
- [x] Prevent transition races: no course alert should arrive after OFFLINE, and ONLINE should precede the first resumed course alert.
- [x] Remove `/tracked` entirely in Local Standby so stale watchlists cannot be requested.

### Medium priority

- [x] Make `start`, `stop`, and deployment repair drift between the SSM mode, EventBridge, request Lambdas, and Discord command state.
- [ ] Decide whether a temporary API/network failure should persistently switch a browser from Discord Alerts to Browser Alerts or only fall back for that session.
- [x] Remove trackers from expired Cornell rosters or sections no longer listed in the current roster, while retaining trackers when Cornell itself is unavailable.
- [x] Protect large scans with incremental commits, a five-minute timeout, remaining-time checks, and rotating continuation order.

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
