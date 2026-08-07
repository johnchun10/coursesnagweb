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

case "$ACTION" in
  start)
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
    echo "CourseSnag is in Cloud Active mode. The shared monitor runs once per minute."
    ;;
  stop)
    RESULT_FILE="$(mktemp)"
    trap 'rm -f "$RESULT_FILE"' EXIT
    aws lambda invoke \
      --function-name "$OPERATIONS_FUNCTION" \
      --cli-binary-format raw-in-base64-out \
      --payload '{"action":"announce-season-shutdown"}' \
      --region "$AWS_REGION" \
      --profile "$AWS_PROFILE" \
      "$RESULT_FILE" >/dev/null
    cat "$RESULT_FILE"
    echo
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
    MODE="$(aws ssm get-parameter --name "$MODE_PARAMETER" --query Parameter.Value --output text --region "$AWS_REGION" --profile "$AWS_PROFILE")"
    RULE_STATE="$(aws events describe-rule --name "$RULE_NAME" --query State --output text --region "$AWS_REGION" --profile "$AWS_PROFILE")"
    echo "Mode: $MODE"
    echo "Monitor rule: $RULE_STATE"
    ;;
  *)
    echo "Usage: $0 {start|stop|status}" >&2
    exit 1
    ;;
esac
