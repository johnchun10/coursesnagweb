# CourseSnag cloud architecture

Last updated: 2026-08-10

## Product model

CourseSnag has two manually selected operating modes:

- **Local Standby:** Cloudflare Pages serves the browser tracker year-round. Tracking and browser alerts require the tab and computer to remain on.
- **Cloud Active:** AWS owns the account watchlist. A shared AWS monitor checks Cornell once per roster-and-subject group every minute and Discord sends direct-message alerts while the computer is off.

Cloudflare hosts the frontend at `https://coursesnag.pages.dev`. AWS hosts only the API, account/watchlist records, monitor, queue, and notification workers.

## Account and authorization flow

Discord is the only CourseSnag account provider and alert destination.

1. The browser requests a ten-minute, single-use OAuth state from AWS.
2. Discord asks the user to identify themselves.
3. Discord returns a one-time code to the AWS callback.
4. AWS exchanges the code server-side, reads the stable Discord user ID and display profile, then immediately revokes the temporary Discord access token.
5. AWS redirects the browser with a two-minute, single-use CourseSnag login code.
6. The browser exchanges that code for a random 30-day CourseSnag session token.
7. DynamoDB stores only the session token's SHA-256 hash. The browser uses the opaque token as a bearer credential for watchlist requests.

Signing out revokes the server-side session but does not erase the browser-local watchlist. Connecting a Discord account replaces the browser list with that account's AWS watchlist, including replacing it with an empty list. Local-only trackers are never uploaded as part of sign-in.

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

EventBridge (once per minute, Cloud Active only)
        |
        v
Monitor Lambda -> Cornell roster API -> DynamoDB status update
                                  \-> FIFO alert queue on status changes
```

Discord's proactive bot DMs require the bot and recipient to share a guild. CourseSnag therefore needs a dedicated Discord server containing the bot and each cloud-alert user. User Install alone does not satisfy this requirement.

Discord messages are generated when:

- a Discord connection succeeds;
- a section changes to open; or
- a section changes to closed/waitlisted, including the first observed status after adding it; or
- Cloud Active is manually placed into Local Standby for the off-season; or
- Local Standby is manually returned to Cloud Active.

Adding and removing trackers does not send Discord messages. The private `/tracked` command lists the caller's current cloud watchlist. If the Discord identity is not linked, it returns a **Set up CourseSnag** link that opens the website's alert-mode onboarding. During Local Standby, the response explicitly warns that saved courses are not being checked and course-status alerts will not be sent. It has a ten-second per-user cooldown, while API Gateway also limits the Discord route to one request per second with a burst of three. Discord request signatures are validated before any account data is read. Seasonal operations deduplicate legacy profile rows by Discord user ID and prefer the canonical Discord-owned profile.

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

## Seasonal control

```text
./scripts/season.sh start   # mode=cloud and monitor rule enabled
./scripts/season.sh stop    # shutdown DMs, monitor disabled, mode=local
./scripts/season.sh status  # current mode and monitor state
```

Local Standby does not delete AWS resources or account data. It disables scheduled monitoring while leaving the small on-demand API available for mode checks and future sign-in.

The seasonal command sends one OFFLINE DM when it changes from Cloud Active to Local Standby and one ONLINE DM when it changes back. Repeating `start` or `stop` while already in that mode does not send another status DM. Every real transition and recipient receives a unique queue identity, so rapid OFFLINE → ONLINE → OFFLINE testing is not suppressed by the FIFO queue's deduplication window.

CourseSnag uses Discord's HTTP API rather than a persistent Gateway connection. This keeps the backend serverless, but Discord therefore shows the bot itself as offline even during Cloud Active. The latest seasonal DM is the durable user-facing status indicator.

Discord OAuth is accepted only after CourseSnag successfully sends the connection-confirmation DM. A failure tells the user to join the shared CourseSnag server and allow direct messages before retrying, instead of creating an account that cannot receive alerts.

Course notifications are re-checked against the live mode by the notifier. Transitional `starting` and `stopping` states keep the scheduled monitor gated while ONLINE/OFFLINE messages are ordered. Cornell roster/subject failures are counted in the persisted monitor result and shown as degraded status. A CloudWatch alarm emails the owner when any message enters the dead-letter queue.

If a browser was previously set to Cloud and AWS reports Local Standby or cannot be reached, the website automatically changes that browser to Local mode. The Cloud choice remains unavailable until Cloud Active returns.

## Security and cost boundaries

- Discord's application ID and the API URL are public identifiers.
- The Discord client secret and bot token are encrypted SSM `SecureString` parameters and are never sent to the browser.
- Discord's public interaction verification key is safe to store in the deployment configuration.
- OAuth states and login codes are random, single use, and short lived.
- CourseSnag session tokens are random, revocable, expire after 30 days, and are stored only as hashes in AWS.
- The API is throttled, private website routes authenticate sessions in Lambda, and Discord commands require Ed25519 signatures plus per-user cooldowns.
- The notifier does not need a continuously connected Discord Gateway process; it uses Discord's HTTP API only when a message is queued.
- DynamoDB and Lambda are on demand, logs expire after seven days, and deployment artifacts expire after 30 days.
- The annual AWS budget is USD 50. Budget alerts warn; they are not a hard cutoff.
