# CourseSnag owner guide

This guide separates actions that require the AWS/Google/Discord account owner from changes that can be managed in the repository.

## What has already been configured

### AWS SSO profile

The `coursesnag` CLI profile signs in through AWS IAM Identity Center. It receives temporary credentials for an assigned role and avoids permanent administrator keys. The selected resource region is `us-east-1`.

Verify it with:

```bash
aws sso login --profile coursesnag
aws sts get-caller-identity --profile coursesnag
```

The returned ARN should contain `assumed-role` or `AWSReservedSSO`, not `root`.

### Google OAuth client

The web client allows `https://coursesnag.pages.dev` as a JavaScript origin. The frontend receives a Google ID token and sends it to AWS. AWS validates that the token was issued by Google for the CourseSnag client ID.

### Discord application

Discord application `1534241192819163296` represents CourseSnag. Its application ID is public. The bot token and OAuth client secret are passwords and must be stored only as encrypted AWS parameters.

### Cloudflare Pages

Cloudflare continues to deploy and host the static website. AWS does not replace it.

## Current deployed foundation

The `coursesnag-dev` stack is deployed in `us-east-1` and remains in Local Standby. Its API base URL is:

```text
https://ysc5mgv0ne.execute-api.us-east-1.amazonaws.com/dev
```

The frontend's public API URL and Google client ID live in `config.js`. These are public identifiers; the Google client secret is not used by the browser.

## Testing Google account sync

Google currently authorizes `https://coursesnag.pages.dev`, and AWS CORS permits that same origin. Therefore, the real sign-in and AWS sync test must run from the deployed Cloudflare Pages site. A local test server will intentionally show a safe Local fallback and Google origin warning unless localhost is separately authorized.

After publishing the frontend:

1. Run `./scripts/season.sh start` so the Cloud option becomes available.
2. Open `https://coursesnag.pages.dev`.
3. Select **Cloud** in the first-run chooser and press **Continue**. Later, **Settings** opens directly to that mode and provides a switch-mode button.
4. Sign in with Google.
5. Track one closed section and confirm the sync status updates in Settings.
6. Reload the page and confirm the tracker remains.
7. Remove it and confirm the removal syncs automatically. Run `./scripts/season.sh stop` when Cloud Active is no longer needed.

There is no separate manual sync control. CourseSnag synchronizes on page load, **Refresh now**, tracker additions, and tracker removals.

The Cloud option is intentionally disabled whenever AWS is not in Cloud Active mode.

## Local Cloud-mode development

Direct `file://` pages have an opaque origin and intentionally remain Local-only. To test Cloud-mode UI locally, serve the site over HTTP, such as `http://localhost:4173`, and add that exact origin to both:

- the Google OAuth client's authorized JavaScript origins; and
- the AWS API CORS allowed origins in the infrastructure configuration.

Keep the production origin authorized as well. Localhost support should be treated as a development setting rather than allowing arbitrary origins.

## Before testing Discord

Use the secret helper, which reads values without echoing them to the terminal:

```bash
./scripts/set-discord-secrets.sh
```

The helper stores two encrypted parameters:

```text
/coursesnag/dev/discord/bot-token
/coursesnag/dev/discord/client-secret
```

Neither value is committed to Git or placed in Lambda environment variables.

## Normal seasonal operations

Start Cloud Active only around enrollment events:

```bash
./scripts/season.sh start
```

Return to Local Standby:

```bash
./scripts/season.sh stop
```

Check the current state at any time:

```bash
./scripts/season.sh status
```

The stop action asks the operations function to queue a shutdown message before disabling the monitor. Users without a connected Discord account are skipped.

## Security reminders

- Do not use the AWS root identity for deployment.
- Do not paste bot tokens or client secrets into chat.
- Do not commit `.env`, OAuth secret JSON files, generated deployment packages, or `node_modules`.
- Rotate a token immediately if it is accidentally exposed.
- Review CloudWatch logs and the AWS Billing dashboard during Cloud Active periods.
