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

stack_output() {
  local key="$1"
  aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='${key}'].OutputValue | [0]" \
    --output text \
    --region "$AWS_REGION" \
    --profile "$AWS_PROFILE"
}

RULE_NAME="$(stack_output MonitorRuleName)"
MODE_PARAMETER="$(stack_output ModeParameterName)"
OPERATIONS_FUNCTION="$(stack_output OperationsFunctionName)"
ACTION="${1:-status}"

current_mode() {
  aws ssm get-parameter \
    --name "$MODE_PARAMETER" \
    --query Parameter.Value \
    --output text \
    --region "$AWS_REGION" \
    --profile "$AWS_PROFILE"
}

announce_season_status() {
  local action="$1"
  local result_file
  result_file="$(mktemp)"
  aws lambda invoke \
    --function-name "$OPERATIONS_FUNCTION" \
    --cli-binary-format raw-in-base64-out \
    --payload "{\"action\":\"${action}\"}" \
    --region "$AWS_REGION" \
    --profile "$AWS_PROFILE" \
    "$result_file" >/dev/null
  cat "$result_file"
  echo
  rm -f "$result_file"
}

case "$ACTION" in
  start)
    PREVIOUS_MODE="$(current_mode)"
    if [[ "$PREVIOUS_MODE" == "cloud" ]]; then
      echo "CourseSnag is already in Cloud Active mode. No Discord alert was sent."
      exit 0
    fi
    aws ssm put-parameter \
      --name "$MODE_PARAMETER" \
      --type String \
      --value cloud \
      --overwrite \
      --region "$AWS_REGION" \
      --profile "$AWS_PROFILE" >/dev/null
    aws events enable-rule \
      --name "$RULE_NAME" \
      --region "$AWS_REGION" \
      --profile "$AWS_PROFILE"
    announce_season_status "announce-season-online"
    echo "CourseSnag is in Cloud Active mode. The shared monitor runs once per minute."
    ;;
  stop)
    PREVIOUS_MODE="$(current_mode)"
    if [[ "$PREVIOUS_MODE" == "local" ]]; then
      echo "CourseSnag is already in Local Standby mode. No Discord alert was sent."
      exit 0
    fi
    announce_season_status "announce-season-offline"
    aws events disable-rule \
      --name "$RULE_NAME" \
      --region "$AWS_REGION" \
      --profile "$AWS_PROFILE"
    aws ssm put-parameter \
      --name "$MODE_PARAMETER" \
      --type String \
      --value local \
      --overwrite \
      --region "$AWS_REGION" \
      --profile "$AWS_PROFILE" >/dev/null
    echo "CourseSnag is in Local Standby mode. Scheduled AWS polling is disabled."
    ;;
  status)
    MODE="$(current_mode)"
    RULE_STATE="$(aws events describe-rule --name "$RULE_NAME" --query State --output text --region "$AWS_REGION" --profile "$AWS_PROFILE")"
    echo "Mode: $MODE"
    echo "Monitor rule: $RULE_STATE"
    ;;
  *)
    echo "Usage: $0 {start|stop|status}" >&2
    exit 1
    ;;
esac
