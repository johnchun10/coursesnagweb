# CourseSnag cloud architecture

Last updated: 2026-08-07

## Product model

CourseSnag has two manually selected operating modes:

- **Local Standby:** Cloudflare Pages serves the browser tracker year-round. Tracking and browser alerts require the tab and computer to remain on.
- **Cloud Active:** the same browser watchlist is synchronized to AWS. A shared AWS monitor checks Cornell once per roster-and-subject group every minute and Discord sends direct-message alerts while the computer is off.

Cloudflare hosts the frontend at `https://coursesnag.pages.dev`. AWS hosts only the API, account/watchlist records, monitor, queue, and notification workers.

## Account and authorization flow

Discord is the only CourseSnag account provider and alert destination.

1. The browser requests a ten-minute, single-use OAuth state from AWS.
2. Discord asks the user to identify themselves and install CourseSnag to their user account.
3. Discord returns a one-time code to the AWS callback.
4. AWS exchanges the code server-side, reads the stable Discord user ID and display profile, then immediately revokes the temporary Discord access token.
5. AWS redirects the browser with a two-minute, single-use CourseSnag login code.
6. The browser exchanges that code for a random 30-day CourseSnag session token.
7. DynamoDB stores only the session token's SHA-256 hash. The browser uses the opaque token as a bearer credential for watchlist requests.

Signing out revokes the server-side session but does not erase the browser-local watchlist. Returning with the same Discord account restores the same cloud watchlist because the Discord user ID is the account key.

## Request and notification flow

```text
Cloudflare Pages browser
        |
        | HTTPS + CourseSnag session token
        v
API Gateway -> API Lambda -> DynamoDB
                         \-> FIFO alert queue -> Notifier Lambda -> Discord DM

EventBridge (once per minute, Cloud Active only)
        |
        v
Monitor Lambda -> Cornell roster API -> DynamoDB status update
                                  \-> FIFO alert queue on status changes
```

Discord messages are generated when:

- a tracker is first added to the cloud watchlist;
- a tracker is removed;
- a section changes to open; or
- a section changes to closed/waitlisted, including the first observed status after adding it.

Repeated page refreshes update existing tracker records and do not repeat the “tracking added” message.

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

The `GSI1` index lets one monitor invocation load every active tracker. Trackers are grouped by roster and subject so CourseSnag does not poll Cornell separately for every account.

## Seasonal control

```text
./scripts/season.sh start   # mode=cloud and monitor rule enabled
./scripts/season.sh stop    # shutdown DMs, monitor disabled, mode=local
./scripts/season.sh status  # current mode and monitor state
```

Local Standby does not delete AWS resources or account data. It disables scheduled monitoring while leaving the small on-demand API available for mode checks and future sign-in.

## Security and cost boundaries

- Discord's application ID and the API URL are public identifiers.
- The Discord client secret and bot token are encrypted SSM `SecureString` parameters and are never sent to the browser.
- OAuth states and login codes are random, single use, and short lived.
- CourseSnag session tokens are random, revocable, expire after 30 days, and are stored only as hashes in AWS.
- The API is throttled and private routes authenticate sessions in Lambda.
- The notifier does not need a continuously connected Discord Gateway process; it uses Discord's HTTP API only when a message is queued.
- DynamoDB and Lambda are on demand, logs expire after seven days, and deployment artifacts expire after 30 days.
- The annual AWS budget is USD 50. Budget alerts warn; they are not a hard cutoff.
