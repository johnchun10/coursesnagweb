# CourseSnag Discord monitoring architecture

Last updated: 2026-08-17

## Product model

CourseSnag has two manually selected operating modes:

- **Local Standby:** Cloudflare Pages serves the browser tracker year-round. Tracking and browser alerts require the tab and computer to remain on.
- **Discord Active:** AWS owns the Discord-linked watchlist. A shared AWS monitor checks Cornell once per roster-and-subject group on the adaptive schedule below, and Discord sends direct-message alerts while the computer is off.

Cloudflare hosts the frontend at `https://coursesnag.pages.dev`. AWS hosts only the API, account/watchlist records, monitor, queue, and notification workers.

The public site and Local mode require no CourseSnag account. Anonymous Local visitors are not included in AWS linked-account or daily-active-user counts. Discord Alerts require a linked Discord identity. The internal persisted mode value remains `cloud` for compatibility even though the product name is Discord Active.

## Account and authorization flow

Discord is the only CourseSnag account provider and alert destination.

1. The browser requests a ten-minute, single-use OAuth state from AWS. The state records whether the request came from the production site or the authorized localhost development origin.
2. One Discord authorization screen asks the user to identify themselves and select a server where they can add apps. The `bot` and `applications.commands` install scopes request zero server permissions.
3. Discord adds CourseSnag to the selected server and returns a one-time code to the AWS callback.
4. AWS exchanges the code server-side, reads the stable Discord user ID and display profile, then immediately revokes the temporary Discord access token.
5. AWS sends a confirmation DM before accepting the connection, proving that future alerts can be delivered.
6. AWS redirects the browser to that exact trusted origin with a two-minute, single-use CourseSnag login code.
7. The browser exchanges that code for a random 30-day CourseSnag session token. DynamoDB stores only its SHA-256 hash.

Signing out revokes the server-side session but does not erase the browser-local watchlist. Connecting a Discord account replaces the browser list with that account's AWS watchlist, including replacing it with an empty list. Local-only trackers are never uploaded as part of sign-in.

API Gateway CORS accepts only `https://coursesnag.pages.dev` and `http://localhost:4173`. The localhost option supports complete Discord-mode UI and Discord OAuth testing without changing the production callback destination globally. `file://`, other ports, and arbitrary origins remain unauthorized.

## Request and notification flow

```text
Cloudflare Pages browser
        |
        | HTTPS + CourseSnag session token
        v
API Gateway -> API Lambda -> DynamoDB
                         \-> FIFO alert queue -> Notifier Lambda -> Discord DM

Discord /tracked -> API Gateway -> Interactions Lambda -> DynamoDB
                      (signed request, private response, per-user cooldown)

EventBridge (every five minutes, Discord Active only)
        |
        v
Monitor Lambda -> adaptive schedule guard -> Cornell roster API -> DynamoDB status update
                                  \-> FIFO alert queue on status changes
```

EventBridge provides a five-minute tick. The monitor applies `America/New_York` time and polls every five minutes from 06:00–16:59, every ten minutes from 17:00–23:59, and every thirty minutes from 00:00–05:59. `season.sh start` also queues one forced first run. A DynamoDB lease prevents overlaps. Subject groups are committed independently, and a partial run rotates its next starting group so later subjects cannot starve.

Discord's proactive bot DMs require the bot and recipient to share a guild. CourseSnag's single authorization flow therefore links the Discord identity and installs the bot into a server selected by the user. The user must have Discord's **Manage Server** permission there, but CourseSnag itself requests zero server permissions. A private server is sufficient. Discord User Install alone does not provide the same reliable scheduled-DM path.

Discord messages are generated when:

- a Discord connection succeeds;
- a section changes to open; or
- a section changes to closed/waitlisted, including the first observed status after adding it; or
- Discord Active is manually placed into Local Standby for the off-season; or
- Local Standby is manually returned to Discord Active.

Adding and removing trackers does not send Discord messages. During Discord Active, the private `/tracked` command lists the caller's current Discord watchlist. If the Discord identity is not linked, it returns a **Set up CourseSnag** link that opens the website's alert-mode onboarding. It has a ten-second per-user cooldown, while API Gateway also limits the Discord route to one request per second with a burst of three. Discord request signatures are validated before any account data is read. During Local Standby, `/tracked` is deleted from Discord and the interactions Lambda has zero concurrency, so there is no offline command response or stale watchlist access. Seasonal operations deduplicate legacy profile rows by Discord user ID and prefer the canonical Discord-owned profile.

## DynamoDB layout

```text
PK = USER#<Discord user ID>
SK = PROFILE
```

```text
PK = USER#<Discord user ID>
SK = TRACKER#<roster>:<class number>
GSI1PK = ACTIVE
GSI1SK = <roster>#<subject>#<class number>#<Discord user ID>
```

Short-lived OAuth states, login codes, and sessions use separate key prefixes and DynamoDB TTL through `expiresAt`.

The `/tracked` cooldown uses a short-lived `RATELIMIT#<Discord user ID>` record with DynamoDB TTL.

The `GSI1` index lets one monitor invocation load every active tracker. Trackers are grouped by roster and subject so CourseSnag does not poll Cornell separately for every account.

The public `/tracker-counts` endpoint queries that same index by roster-and-subject prefix, aggregates distinct tracker owners for up to 100 requested class numbers, and returns counts only. Responses are cached for 30 seconds and contain no user identifiers. The frontend labels them **Discord watchers** because Local-mode watchlists remain private in the browser and cannot be counted.

## Seasonal control

```text
./scripts/season.sh start   # internal mode=cloud; Discord Active and monitor enabled
./scripts/season.sh stop    # shutdown DMs, monitor disabled, mode=local
./scripts/season.sh status  # current mode and monitor state
```

Local Standby does not delete AWS resources or account data. It disables scheduled monitoring, removes `/tracked`, and sets both request-facing Lambdas—the website API and Discord interactions—to zero concurrency. Existing Browser Alerts users check Discord availability lazily when watcher counts or Discord settings are requested; browsers transitioning from Discord Alerts fall back to Local mode when the service is unavailable. Switching back to Discord Active begins loading the Discord-authoritative watchlist.

The seasonal command sends one OFFLINE DM when it changes from Discord Active to Local Standby and one ONLINE DM when it changes back. It also sets persistent `Status: OFFLINE` or `Status: ONLINE` text on the line immediately below the website link, without an empty line between them. Repeating `start` or `stop` while already in that mode does not send another status DM, but it reasserts the correct EventBridge, command, Lambda, and description state. Deployment runs this same no-notice reconciliation for a stable mode and refuses to guess if a prior transition is incomplete. Every real transition and recipient receives a unique queue identity, so rapid OFFLINE → ONLINE → OFFLINE testing is not suppressed by the FIFO queue's deduplication window.

CourseSnag uses Discord's HTTP API rather than a persistent Gateway connection. This keeps the backend serverless, but Discord therefore shows the bot's presence dot as offline even during Discord Active. The application-description status and latest seasonal DM are the durable user-facing indicators; there is no additional OFFLINE command response.

Discord OAuth is accepted only after CourseSnag successfully sends the connection-confirmation DM. A failure tells the user to allow direct messages from members of the selected server before retrying, instead of creating an account that cannot receive alerts.

Course notifications are re-checked against the live mode by the notifier. Transitional `starting` and `stopping` states keep the scheduled monitor gated while ONLINE/OFFLINE messages are ordered. Cornell roster/subject failures are counted in the persisted monitor result and shown as degraded status. A CloudWatch alarm emails the owner when any message enters the dead-letter queue.

The website and Discord monitor read Cornell's default-roster setting instead of relying on a manually maintained semester. Trackers tied to another roster are removed automatically. If Cornell successfully returns the current subject but a tracked section is absent, that tracker is also removed. These cleanup removals do not send Discord alerts. When Cornell's roster or subject request fails, CourseSnag records degraded health and retains the trackers because absence has not been confirmed.

If a browser was previously set to Discord Alerts and AWS reports Local Standby or cannot be reached, the website automatically changes that browser to Local mode. The Discord choice remains unavailable until Discord Active returns.

## Security and cost boundaries

- Discord's application ID and the API URL are public identifiers.
- The Discord client secret and bot token are encrypted SSM `SecureString` parameters and are never sent to the browser.
- Discord's public interaction verification key is safe to store in the deployment configuration.
- OAuth states and login codes are random, single use, and short lived.
- OAuth return locations are restricted to the configured production and localhost origins to prevent open redirects.
- CourseSnag session tokens are random, revocable, expire after 30 days, and are stored only as hashes in AWS.
- The API is throttled, private website routes authenticate sessions in Lambda, and Discord commands require Ed25519 signatures plus per-user cooldowns.
- The notifier does not need a continuously connected Discord Gateway process; it uses Discord's HTTP API only when a message is queued.
- DynamoDB and Lambda are on demand, logs expire after seven days, and deployment artifacts expire after 30 days.
- Local Standby prevents CourseSnag Lambda execution but retains data and infrastructure. DynamoDB/S3 storage and the CloudWatch dead-letter alarm can still incur small charges, so Local Standby is not an absolute zero-dollar state.
- The annual AWS budget is USD 50. Budget alerts warn; they are not a hard cutoff.
