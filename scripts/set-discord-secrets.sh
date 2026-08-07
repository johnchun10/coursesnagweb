#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SETTINGS_FILE="$PROJECT_ROOT/infra/parameters.local.env"

set -a
source "$SETTINGS_FILE"
set +a

: "${AWS_PROFILE:=coursesnag}"
: "${AWS_REGION:=us-east-1}"
: "${STAGE_NAME:=dev}"

read -r -s -p "Discord bot token: " BOT_TOKEN
echo
read -r -s -p "Discord OAuth client secret: " CLIENT_SECRET
echo

aws ssm put-parameter \
  --name "/coursesnag/${STAGE_NAME}/discord/bot-token" \
  --description "CourseSnag Discord bot token" \
  --type SecureString \
  --value "$BOT_TOKEN" \
  --overwrite \
  --region "$AWS_REGION" \
  --profile "$AWS_PROFILE" >/dev/null

aws ssm put-parameter \
  --name "/coursesnag/${STAGE_NAME}/discord/client-secret" \
  --description "CourseSnag Discord OAuth client secret" \
  --type SecureString \
  --value "$CLIENT_SECRET" \
  --overwrite \
  --region "$AWS_REGION" \
  --profile "$AWS_PROFILE" >/dev/null

unset BOT_TOKEN CLIENT_SECRET
echo "Discord secrets are encrypted in SSM Parameter Store."
