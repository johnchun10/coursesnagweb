#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SETTINGS_FILE="$PROJECT_ROOT/infra/parameters.local.env"

set -a
source "$SETTINGS_FILE"
set +a

: "${AWS_PROFILE:=coursesnag}"
: "${AWS_REGION:=us-east-1}"
: "${STACK_NAME:=coursesnag-dev}"
: "${STAGE_NAME:=dev}"
: "${DISCORD_APPLICATION_ID:?DISCORD_APPLICATION_ID is required}"

INTERACTIONS_URL="$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='DiscordInteractionsUrl'].OutputValue | [0]" \
  --output text \
  --region "$AWS_REGION" \
  --profile "$AWS_PROFILE")"

DISCORD_BOT_TOKEN="$(aws ssm get-parameter \
  --name "/coursesnag/${STAGE_NAME}/discord/bot-token" \
  --with-decryption \
  --query Parameter.Value \
  --output text \
  --region "$AWS_REGION" \
  --profile "$AWS_PROFILE")"
trap 'unset DISCORD_BOT_TOKEN' EXIT

ENDPOINT_BODY="$(jq -nc --arg url "$INTERACTIONS_URL" '{interactions_endpoint_url: $url}')"
curl -fsS \
  -X PATCH \
  -H "Authorization: Bot $DISCORD_BOT_TOKEN" \
  -H 'Content-Type: application/json' \
  --data "$ENDPOINT_BODY" \
  https://discord.com/api/v10/applications/@me >/dev/null

COMMAND_BODY="$(jq -nc '{
  name: "tracked",
  type: 1,
  description: "Show the courses in your CourseSnag cloud watchlist",
  integration_types: [0],
  contexts: [0, 1]
}')"
curl -fsS \
  -X POST \
  -H "Authorization: Bot $DISCORD_BOT_TOKEN" \
  -H 'Content-Type: application/json' \
  --data "$COMMAND_BODY" \
  "https://discord.com/api/v10/applications/${DISCORD_APPLICATION_ID}/commands" >/dev/null

echo "Discord interactions endpoint configured: $INTERACTIONS_URL"
echo "Discord command registered: /tracked"
