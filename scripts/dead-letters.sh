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

DEAD_LETTER_QUEUE_URL="$(aws cloudformation describe-stack-resource \
  --stack-name "$STACK_NAME" \
  --logical-resource-id AlertDeadLetterQueue \
  --query StackResourceDetail.PhysicalResourceId \
  --output text \
  --region "$AWS_REGION" \
  --profile "$AWS_PROFILE")"
ACTION="${1:-inspect}"

case "$ACTION" in
  inspect)
    MESSAGES="$(aws sqs receive-message \
      --queue-url "$DEAD_LETTER_QUEUE_URL" \
      --max-number-of-messages 10 \
      --visibility-timeout 0 \
      --wait-time-seconds 1 \
      --attribute-names All \
      --output json \
      --region "$AWS_REGION" \
      --profile "$AWS_PROFILE")"
    if [[ -z "$MESSAGES" ]]; then
      MESSAGES='{}'
    fi
    COUNT="$(jq -r '(.Messages // []) | length' <<<"$MESSAGES")"
    echo "Dead-letter messages inspected: $COUNT"
    jq -r '
      (.Messages // [])[]
      | (.Body | fromjson) as $body
      | "  \($body.type // "unknown") | \($body.tracker.subject // "") \($body.tracker.catalogNbr // "") | received \(.Attributes.ApproximateReceiveCount // "unknown") times"
    ' <<<"$MESSAGES"
    echo "Messages remain quarantined; inspect does not delete or replay them."
    ;;
  purge)
    read -r -p "Type PURGE to permanently delete every quarantined CourseSnag alert: " CONFIRMATION
    if [[ "$CONFIRMATION" != "PURGE" ]]; then
      echo "Purge cancelled."
      exit 1
    fi
    aws sqs purge-queue \
      --queue-url "$DEAD_LETTER_QUEUE_URL" \
      --region "$AWS_REGION" \
      --profile "$AWS_PROFILE"
    echo "All CourseSnag dead-letter messages were permanently deleted."
    ;;
  *)
    echo "Usage: $0 {inspect|purge}" >&2
    exit 1
    ;;
esac
