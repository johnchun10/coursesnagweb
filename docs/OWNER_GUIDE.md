# CourseSnag owner guide

Last updated: 2026-08-07

## Configured services

- Frontend: Cloudflare Pages at `https://coursesnag.pages.dev`
- AWS account: CLI profile `coursesnag`, region `us-east-1`
- AWS stack: `coursesnag-dev`
- API: `https://ysc5mgv0ne.execute-api.us-east-1.amazonaws.com/dev`
- Discord application: `1534241192819163296`
- Discord callback: `https://ysc5mgv0ne.execute-api.us-east-1.amazonaws.com/dev/discord/callback`
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

Never commit, print, or paste those values. The public application ID is safe to commit.

## Deploying repository changes

```bash
aws sso login --profile coursesnag
./scripts/deploy.sh
```

Cloudflare Pages already deploys the frontend from GitHub. No separate GitHub publishing workflow or manual Cloudflare upload is needed: push the intended frontend commit to the connected branch and wait for Pages to finish.

## Testing cloud tracking

1. Run `./scripts/season.sh start`.
2. Confirm the CourseSnag bot and tester share a Discord server.
3. Open `https://coursesnag.pages.dev` and select Cloud.
4. Select **Continue with Discord** and approve the CourseSnag sign-in.
5. Confirm Settings displays the Discord account and Discord receives the connection confirmation.
6. Add a section and confirm it remains after a page refresh.
7. Confirm Discord sends “tracking added,” followed by the first observed open/not-open status.
8. Remove the section and confirm Discord sends “tracking stopped.”

The browser copy and cloud copy are synchronized. Signing out leaves the local browser watchlist intact. Signing in on another device with the same Discord account downloads the cloud watchlist.

## Local Cloud-mode development

Direct `file://` pages have an opaque origin and remain Local-only. To test Cloud mode locally, serve the site over HTTP, such as `http://localhost:4173`, and add that exact origin to the AWS HTTP API CORS configuration while retaining the production origin.

The deployed Discord callback can remain unchanged, but `FRONTEND_ORIGIN` must point to the frontend being tested if the callback should return to localhost. Treat localhost as a temporary development configuration and restore the production origin before release.

## Seasonal operation

```bash
./scripts/season.sh status
./scripts/season.sh start
./scripts/season.sh stop
```

Use these commands instead of turning individual AWS resources on and off in the console. `stop` queues the off-season Discord notice before disabling the monitor and setting Local Standby. Account/watchlist data and the static website remain available.

## Operational checks

```bash
aws sts get-caller-identity --profile coursesnag
aws logs tail /aws/lambda/coursesnag-dev-api --since 30m --profile coursesnag --region us-east-1
aws logs tail /aws/lambda/coursesnag-dev-notifier --since 30m --profile coursesnag --region us-east-1
```

The caller ARN should contain an assumed SSO role, not `root`. Review CloudWatch and AWS Billing during Cloud Active periods.

## Remaining production work

- Add Privacy and Terms pages and configure their URLs in Discord.
- Verify notifier retry/dead-letter behavior.
- Run a complete Cloud Active → Local Standby → Cloud Active rehearsal.
- Add local watchlist export/import.
