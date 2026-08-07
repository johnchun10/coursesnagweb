# CourseSnag cloud architecture

CourseSnag keeps the existing Cloudflare Pages site as the permanent frontend and adds an AWS backend that is useful only during enrollment periods.

## The two modes

### Local Standby

- Cloudflare serves `https://coursesnag.pages.dev`.
- The browser calls Cornell directly, just as the current site does.
- The watchlist stays in browser `localStorage`.
- The page must remain open for polling and browser alerts.
- The AWS monitoring schedule is disabled, so there is no recurring backend work.

### Cloud Active

- The same Cloudflare website remains the user interface.
- Google identifies the CourseSnag account.
- AWS stores a copy of the user's cloud-enabled watchlist.
- One scheduled monitor checks all users' tracked classes together.
- Newly opened sections are placed on an alert queue.
- A notification worker sends Discord direct messages.

Account storage and scheduled monitoring are separate backend capabilities, but the website exposes Cloud setup only while Cloud Active is available.

The website's setup flow presents Local and Cloud as user-facing alert modes. Local is always available. Cloud is selectable only while the AWS mode parameter reports `cloud`; during Local Standby or an AWS outage, the Cloud choice is shown as unavailable and the user can switch back to Local from Settings.

## Watchlist synchronization

The browser watchlist remains the local fallback and is never cleared by signing in or out.

- A sign-in merges cloud-only trackers into browser storage, then uploads local trackers to the account.
- Tracking a section writes locally first and then attempts the account write.
- Removing a section writes a temporary local deletion marker, or tombstone, so an older cloud copy cannot reappear on the next sign-in.
- Cloud/API failures leave the local watchlist untouched.
- Deletion markers expire after 90 days.

This makes switching back to Local Standby automatic for each browser: the same local preferences are already present when scheduled cloud monitoring stops.

## Request and alert flow

```text
Cloudflare Pages
      |
      | HTTPS requests carrying a Google ID token
      v
API Gateway -- validates the token's issuer and CourseSnag client ID
      |
      v
API Lambda -- reads and writes account/watchlist records
      |
      v
DynamoDB

EventBridge rule (once per minute, disabled in Local Standby)
      |
      v
Monitor Lambda -- batches watchlists by Cornell roster + subject
      |
      +--> Cornell Class Roster API
      |
      v
SQS alert queue -- holds alerts and retries transient failures
      |
      v
Notifier Lambda -- retrieves the bot token securely and calls Discord
```

## Why each AWS service exists

| Service | Role | Idle-cost approach |
| --- | --- | --- |
| API Gateway HTTP API | Gives the website a secure HTTPS backend | Charged by request; no server runs while idle |
| Lambda | Runs API, monitoring, and notification code | Charged only when invoked |
| DynamoDB | Stores profiles and cloud watchlists | On-demand capacity; no reserved database server |
| EventBridge | Invokes the monitor once per minute in Cloud Active | Rule is disabled in Local Standby |
| SQS | Buffers Discord alerts and retries failures | Charged by request; empty queues do no processing |
| Parameter Store | Stores mode state and encrypted Discord secrets | Standard parameters have no additional storage charge |
| CloudWatch Logs | Keeps short diagnostic logs | Seven-day retention prevents indefinite accumulation |
| AWS Budgets | Emails spend warnings | Annual account-level ceiling is USD 50 |

## Data model

One DynamoDB table holds two item types.

Profile item:

```text
PK = USER#<Google subject ID>
SK = PROFILE
```

Tracker item:

```text
PK = USER#<Google subject ID>
SK = TRACKER#<roster>:<class number>
GSI1PK = ACTIVE
GSI1SK = <roster>#<subject>#<class number>#<Google subject ID>
```

The primary key efficiently loads one account's watchlist. The secondary index lets the monitor load all active trackers without scanning unrelated profile records.

## Duplicate-work prevention

The monitor groups trackers by Cornell roster and subject. If 100 people track Fall CS classes, CourseSnag fetches that Cornell subject once and compares the response with all 100 watchlists. It does not create one polling process per person.

## Authentication boundaries

- The Google client ID and Discord application ID are public identifiers.
- Google ID tokens are validated by API Gateway before private API routes run.
- The Google client secret is not needed for the planned Sign in with Google ID-token flow.
- The Discord bot token and Discord OAuth client secret are encrypted in SSM Parameter Store and never sent to the browser.
- AWS deployment uses the temporary `coursesnag` SSO profile rather than root credentials.

## Seasonal control

The owner command has three operations:

```text
./scripts/season.sh start   # mode=cloud and monitoring enabled
./scripts/season.sh stop    # shutdown notices, monitoring disabled, mode=local
./scripts/season.sh status  # display current mode and rule state
```

The initial deployment leaves the rule disabled and the mode set to `local`. Cloud monitoring will not begin merely because the stack exists.

## Cost guardrails

- Annual AWS budget: USD 50.
- Monitor timeout: 55 seconds, shorter than the one-minute schedule interval.
- One monitor execution per minute rather than per user.
- DynamoDB on-demand capacity.
- API authentication and request throttling.
- Seven-day log retention.
- No EC2, RDS, NAT Gateway, load balancer, Route 53, Fargate, or always-running bot.
- The artifact bucket automatically expires deployment packages after 30 days.

AWS Budgets sends warnings but is not a hard spending cutoff. The architecture therefore controls cost at the service level as well.
