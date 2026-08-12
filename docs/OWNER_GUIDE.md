# CourseSnag owner guide

Last updated: 2026-08-11

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

Deployment reconciles AWS and Discord with the current stable mode without sending a seasonal DM. In Cloud Active it enables the request Lambdas and monitor, validates the interaction endpoint, and registers `/tracked`; in Local Standby it disables the request Lambdas and monitor and removes `/tracked`. It also sets the application description's `Status: ONLINE` or `Status: OFFLINE` text on the line immediately below the CourseSnag link, without an empty line between them. Deployment stops with an error instead of guessing if it finds a transitional `starting` or `stopping` mode.

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

CourseSnag automatically follows the roster Cornell marks as current. When Cornell advances to a new term, old-term trackers are removed from browsers when the site loads and from AWS on the next active monitor run. A section that disappears from a successful current-roster response is removed as well. Cleanup does not send a Discord message. If Cornell is unavailable or returns an error, CourseSnag keeps the trackers and reports degraded monitoring rather than treating uncertain data as removal.

## Local Cloud-mode development

Direct `file://` pages have an opaque origin and remain Local-only. The deployed API authorizes exactly the production site and `http://localhost:4173`. Start the local site with:

```bash
./scripts/local.sh
```

Then open `http://localhost:4173`. Cloud Active status, watchlist synchronization, and Discord sign-in all work from that origin. Each OAuth attempt stores its trusted return origin, so a local sign-in returns to localhost while a production sign-in returns to Cloudflare; the AWS callback itself does not change. A localhost browser has separate browser storage and must connect Discord once even if the production site is already signed in.

The helper intentionally uses port `4173`. Another port is blocked unless both the deployment setting and local helper are deliberately changed. Cloud testing remains unavailable while CourseSnag is in Local Standby because the request Lambda is disabled.

## Public policy pages

- Privacy Policy: `https://coursesnag.pages.dev/privacy.html`
- Terms of Service: `https://coursesnag.pages.dev/terms.html`

Both URLs are configured in the Discord Developer Portal. As of August 11, 2026, the portal reports only team-owner identity verification as outstanding. That step can wait until formal app verification or scaling beyond 100 servers. Review the policy text before opening CourseSnag beyond the current test group, especially the manual data-request contact route through the shared Discord server.

## Seasonal operation

```bash
./scripts/season.sh status
./scripts/season.sh start
./scripts/season.sh stop
```

Use these commands instead of turning individual AWS resources on and off in the console. `stop` queues the one-time OFFLINE Discord notice, removes `/tracked`, disables scheduled monitoring, and hard-disables the website API and Discord interaction Lambdas with zero concurrency. `start` restores both request functions and `/tracked`, enables monitoring, and queues the ONLINE notice. Both commands update the Discord application description with the matching status. Repeating a command while CourseSnag is already in that mode does not send duplicate notices, but it repairs any drift in the command, function, or description state. Browsers previously using Cloud automatically switch to Local when the API becomes unavailable. Account/watchlist data and the static website remain available.

Run them from the project directory on the Mac where the AWS CLI profile is configured. In Local Standby, browsers that already use Local do not contact AWS during routine page loads; opening Settings performs a fresh availability check. Do not manually delete or disable individual AWS resources.

`status` is the owner dashboard. It reports monitoring state, API health, Discord-account and tracker counts, unique daily active users, the last monitor result, alert queue and dead-letter counts, invocation/error totals for the last 24 hours, and annual budget usage. A daily active user is a unique linked Discord account that signed in, used the cloud website, or ran `/tracked` during the previous 24 hours. The command is read-only and does not send Discord messages or change monitoring mode. AWS billing totals can lag by about 24 hours.

Inspect quarantined alerts without changing them with `./scripts/dead-letters.sh inspect`. Permanently clear the dead-letter queue with `./scripts/dead-letters.sh purge`; the command requires typing `PURGE` and does not replay messages.

The Discord bot uses on-demand HTTP requests, not a continuously connected Discord Gateway process. Its Discord presence dot therefore appears offline in both seasonal modes. The persistent `Status: ONLINE` or `Status: OFFLINE` application-description line and the most recent seasonal DM communicate the actual CourseSnag monitoring state without adding a continuously running AWS service.

Free-form messages sent to the bot are not received by CourseSnag. During Cloud Active, `/tracked` lists the cloud watchlist. During Local Standby, the command is removed from Discord and its Lambda cannot execute. The only OFFLINE notices are the one-time transition DM sent by `season.sh stop` and the persistent application-description status; Discord does not automatically respond to ordinary messages.

After deploying the operations alarm for the first time, confirm the separate AWS SNS subscription email. Budget-alert confirmation does not also confirm operational alerts. Local Standby stops recurring CourseSnag compute, but it is not a literal zero-dollar guarantee: the retained DynamoDB/S3 data and the dead-letter CloudWatch alarm can still have small storage or fixed charges. The dead-letter alarm costs approximately USD 0.10 per month at standard CloudWatch alarm pricing.

## Operational checks

```bash
aws sts get-caller-identity --profile coursesnag
aws logs tail /aws/lambda/coursesnag-dev-api --since 30m --profile coursesnag --region us-east-1
aws logs tail /aws/lambda/coursesnag-dev-notifier --since 30m --profile coursesnag --region us-east-1
aws logs tail /aws/lambda/coursesnag-dev-interactions --since 30m --profile coursesnag --region us-east-1
```

The caller ARN should contain an assumed SSO role, not `root`. Review CloudWatch and AWS Billing during Cloud Active periods.

## Remaining production work

- Review the policies before public use.
- Complete Discord team-owner identity verification before formal app verification or scaling beyond 100 servers.
