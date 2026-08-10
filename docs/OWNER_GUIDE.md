# CourseSnag owner guide

Last updated: 2026-08-10

## Configured services

- Frontend: Cloudflare Pages at `https://coursesnag.pages.dev`
- AWS account: CLI profile `coursesnag`, region `us-east-1`
- AWS stack: `coursesnag-dev`
- API: `https://ysc5mgv0ne.execute-api.us-east-1.amazonaws.com/dev`
- Discord application: `1534241192819163296`
- Discord callback: `https://ysc5mgv0ne.execute-api.us-east-1.amazonaws.com/dev/discord/callback`
- Discord interactions: `https://ysc5mgv0ne.execute-api.us-east-1.amazonaws.com/dev/discord/interactions`
- Annual AWS budget: USD 50 with 20%, 50%, 80%, and 100% alerts

CourseSnag sign-in requests only Discord's `identify` scope. The website uses the resulting Discord ID for cloud ownership and direct-message delivery. Google is not part of the account flow.

Discord requires a proactive bot-DM recipient and bot to share a server. Add the CourseSnag bot to a dedicated server and ensure every cloud-alert user joins it. For a future public flow, CourseSnag can request `guilds.join` and add consenting users automatically during OAuth.

## Secret storage

Run the helper only when initially configuring or rotating Discord credentials:

```bash
./scripts/set-discord-secrets.sh
```

It writes encrypted values to:

```text
/coursesnag/dev/discord/bot-token
/coursesnag/dev/discord/client-secret
```

Never commit, print, or paste those values. The application ID and interaction verification key are public and safe to store in deployment configuration.

## Deploying repository changes

```bash
aws sso login --profile coursesnag
./scripts/deploy.sh
```

Deployment also validates Discord's interaction endpoint and registers the global `/tracked` command.

Cloudflare Pages already deploys the frontend from GitHub. No separate GitHub publishing workflow or manual Cloudflare upload is needed: push the intended frontend commit to the connected branch and wait for Pages to finish.

## Testing cloud tracking

1. Run `./scripts/season.sh start`.
2. Confirm the CourseSnag bot and tester share a Discord server.
3. Open `https://coursesnag.pages.dev` and select Cloud.
4. Select **Continue with Discord** and approve the CourseSnag sign-in.
5. Confirm Settings displays the Discord account and Discord receives the connection confirmation.
6. Add a section and confirm it remains after a page refresh.
7. Run `/tracked` in the CourseSnag Discord DM and confirm its private response lists the section.
8. Confirm Discord sends the first observed open/not-open status, but no message merely for adding or removing the section.
9. Remove the section and confirm `/tracked` no longer lists it.

While signed in, browser changes are saved to AWS. Signing out leaves the browser list intact. Signing in on any device replaces that browser's list with the Discord account's AWS watchlist; browser-only trackers are not merged or uploaded during sign-in.

## Local Cloud-mode development

Direct `file://` pages have an opaque origin and remain Local-only. To test Cloud mode locally, serve the site over HTTP, such as `http://localhost:4173`, and add that exact origin to the AWS HTTP API CORS configuration while retaining the production origin.

The deployed Discord callback can remain unchanged, but `FRONTEND_ORIGIN` must point to the frontend being tested if the callback should return to localhost. Treat localhost as a temporary development configuration and restore the production origin before release.

## Seasonal operation

```bash
./scripts/season.sh status
./scripts/season.sh start
./scripts/season.sh stop
```

Use these commands instead of turning individual AWS resources on and off in the console. `stop` queues the OFFLINE Discord notice before disabling the monitor and setting Local Standby. `start` enables monitoring and queues the ONLINE notice. Repeating a command while CourseSnag is already in that mode does not send duplicate notices. On the next mode check or page refresh after `stop`, browsers previously using Cloud automatically switch to Local mode. Account/watchlist data and the static website remain available.

Run them from the project directory on the Mac where the AWS CLI profile is configured. Local Standby keeps the small serverless API available so the website can select Local automatically and keep the Cloud choice unavailable; there is no continuously running server to stop. Do not manually delete or disable individual AWS resources.

`status` is the owner dashboard. It reports the active AWS account and region, seasonal mode, API health, Discord-account and tracker counts, the last monitor result, alert queue and dead-letter counts, invocation/error totals for the last 24 hours, and annual budget usage. It is read-only and does not send Discord messages or change monitoring mode. AWS billing totals can lag by about 24 hours.

Inspect quarantined alerts without changing them with `./scripts/dead-letters.sh inspect`. Permanently clear the dead-letter queue with `./scripts/dead-letters.sh purge`; the command requires typing `PURGE` and does not replay messages.

The Discord bot uses on-demand HTTP requests, not a continuously connected Discord Gateway process. Its Discord presence therefore appears offline in both seasonal modes. The most recent ONLINE or OFFLINE DM communicates the actual CourseSnag monitoring state without adding a continuously running AWS service.

Free-form messages sent to the bot are not received by CourseSnag. Use `/tracked` for an on-demand response. The OFFLINE message is a one-time transition DM sent by `season.sh stop`; Discord stores it in the conversation, but does not automatically resend it when a user writes another message.

After deploying the operations alarm for the first time, confirm the separate AWS SNS subscription email. Budget-alert confirmation does not also confirm operational alerts. The dead-letter alarm costs approximately USD 0.10 per month at standard CloudWatch alarm pricing.

## Operational checks

```bash
aws sts get-caller-identity --profile coursesnag
aws logs tail /aws/lambda/coursesnag-dev-api --since 30m --profile coursesnag --region us-east-1
aws logs tail /aws/lambda/coursesnag-dev-notifier --since 30m --profile coursesnag --region us-east-1
aws logs tail /aws/lambda/coursesnag-dev-interactions --since 30m --profile coursesnag --region us-east-1
```

The caller ARN should contain an assumed SSO role, not `root`. Review CloudWatch and AWS Billing during Cloud Active periods.

## Remaining production work

- Add Privacy and Terms pages and configure their URLs in Discord.
- Verify notifier retry/dead-letter behavior.
- Run a complete Cloud Active → Local Standby → Cloud Active rehearsal.
- Add local watchlist export/import.
