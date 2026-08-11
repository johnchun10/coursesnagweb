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

ACTION="${1:-sync}"

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

case "$ACTION" in
  online) DISCORD_STATUS="ONLINE" ;;
  offline) DISCORD_STATUS="OFFLINE" ;;
  sync)
    CURRENT_MODE="$(aws ssm get-parameter \
      --name "/coursesnag/${STAGE_NAME}/mode" \
      --query Parameter.Value \
      --output text \
      --region "$AWS_REGION" \
      --profile "$AWS_PROFILE")"
    if [[ "$CURRENT_MODE" == "cloud" ]]; then
      DISCORD_STATUS="ONLINE"
    else
      DISCORD_STATUS="OFFLINE"
    fi
    ;;
  *)
    echo "Usage: $0 {online|offline|sync}" >&2
    exit 1
    ;;
esac
DISCORD_DESCRIPTION="Track and get alerts for your Cornell courses: https://coursesnag.pages.dev Status: $DISCORD_STATUS"

if [[ "$DISCORD_STATUS" == "ONLINE" ]]; then
  ENDPOINT_BODY="$(jq -nc \
    --arg url "$INTERACTIONS_URL" \
    --arg description "$DISCORD_DESCRIPTION" \
    '{interactions_endpoint_url: $url, description: $description}')"
else
  ENDPOINT_BODY="$(jq -nc \
    --arg description "$DISCORD_DESCRIPTION" \
    '{description: $description}')"
fi
curl -fsS \
  -X PATCH \
  -H "Authorization: Bot $DISCORD_BOT_TOKEN" \
  -H 'Content-Type: application/json' \
  --data "$ENDPOINT_BODY" \
  https://discord.com/api/v10/applications/@me >/dev/null

if [[ "$DISCORD_STATUS" == "ONLINE" ]]; then
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
  COMMAND_RESULT="registered"
else
  COMMAND_IDS="$(curl -fsS \
    -H "Authorization: Bot $DISCORD_BOT_TOKEN" \
    "https://discord.com/api/v10/applications/${DISCORD_APPLICATION_ID}/commands" \
    | jq -r '.[] | select(.name == "tracked" and .type == 1) | .id')"
  while IFS= read -r command_id; do
    [[ -z "$command_id" ]] && continue
    curl -fsS \
      -X DELETE \
      -H "Authorization: Bot $DISCORD_BOT_TOKEN" \
      "https://discord.com/api/v10/applications/${DISCORD_APPLICATION_ID}/commands/${command_id}" >/dev/null
  done <<<"$COMMAND_IDS"
  COMMAND_RESULT="removed"
fi

if [[ "$DISCORD_STATUS" == "ONLINE" ]]; then
  echo "Discord interactions endpoint configured: $INTERACTIONS_URL"
fi
echo "Discord application description updated: Status: $DISCORD_STATUS"
echo "Discord command $COMMAND_RESULT: /tracked"
