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
MONITOR_FUNCTION="$(stack_output MonitorFunctionName)"
ACTION="${1:-status}"

current_mode() {
  aws ssm get-parameter \
    --name "$MODE_PARAMETER" \
    --query Parameter.Value \
    --output text \
    --region "$AWS_REGION" \
    --profile "$AWS_PROFILE"
}

stack_resource() {
  local logical_id="$1"
  aws cloudformation describe-stack-resource \
    --stack-name "$STACK_NAME" \
    --logical-resource-id "$logical_id" \
    --query StackResourceDetail.PhysicalResourceId \
    --output text \
    --region "$AWS_REGION" \
    --profile "$AWS_PROFILE"
}

metric_total() {
  local metric_data="$1"
  local metric_id="$2"
  jq -r --arg id "$metric_id" \
    '[.MetricDataResults[] | select(.Id == $id) | .Values[]] | add // 0 | round' \
    <<<"$metric_data"
}

show_status() {
  if ! command -v jq >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
    echo "Detailed status requires jq and curl." >&2
    return 1
  fi

  local mode rule_state mode_label schedule_label
  local account_id api_base_url table_name alert_queue_url dead_letter_queue_url
  local api_function monitor_function notifier_function interactions_function operations_function
  local api_health health_code health_seconds
  local tracker_count account_json account_count daily_active_users queue_json pending in_flight delayed dead_letters
  local monitor_json monitor_status monitor_completed monitor_checked monitor_groups monitor_processed monitor_deferred monitor_failed_groups monitor_alerts monitor_removed monitor_interval
  local end_time start_time metric_queries metric_data
  local budget_json budget_limit actual_spend forecast_spend

  mode="$(current_mode)"
  rule_state="$(aws events describe-rule --name "$RULE_NAME" --query State --output text --region "$AWS_REGION" --profile "$AWS_PROFILE")"
  account_id="$(aws sts get-caller-identity --query Account --output text --profile "$AWS_PROFILE")"
  api_base_url="$(stack_output ApiBaseUrl)"
  table_name="$(stack_output TableName)"
  alert_queue_url="$(stack_output AlertQueueUrl)"
  dead_letter_queue_url="$(stack_resource AlertDeadLetterQueue)"
  api_function="$(stack_resource ApiFunction)"
  monitor_function="$(stack_resource MonitorFunction)"
  notifier_function="$(stack_resource NotifierFunction)"
  interactions_function="$(stack_resource InteractionsFunction)"
  operations_function="$(stack_resource OperationsFunction)"

  case "$mode" in
    cloud) mode_label="ONLINE" ;;
    starting) mode_label="STARTING" ;;
    stopping) mode_label="STOPPING" ;;
    *) mode_label="OFFLINE" ;;
  esac
  if [[ "$rule_state" == "ENABLED" ]]; then
    schedule_label="Enabled (adaptive 5/10/30-minute Cornell polling)"
  else
    schedule_label="Disabled"
  fi

  api_health="$(curl --silent --show-error --max-time 8 --output /dev/null --write-out '%{http_code} %{time_total}' "$api_base_url/health" 2>/dev/null || true)"
  read -r health_code health_seconds <<<"$api_health"

  end_time="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  if start_time="$(date -u -v-24H '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null)"; then
    :
  else
    start_time="$(date -u -d '24 hours ago' '+%Y-%m-%dT%H:%M:%SZ')"
  fi

  if ! tracker_count="$(aws dynamodb query \
    --table-name "$table_name" \
    --index-name GSI1 \
    --key-condition-expression 'GSI1PK = :active' \
    --expression-attribute-values '{":active":{"S":"ACTIVE"}}' \
    --select COUNT \
    --query Count \
    --output text \
    --region "$AWS_REGION" \
    --profile "$AWS_PROFILE" 2>/dev/null)"; then
    tracker_count="Unavailable"
  fi
  if account_json="$(aws dynamodb scan \
    --table-name "$table_name" \
    --filter-expression 'entityType = :profile AND attribute_exists(discordUserId)' \
    --expression-attribute-values '{":profile":{"S":"profile"}}' \
    --projection-expression 'discordUserId, lastActiveAt' \
    --output json \
    --region "$AWS_REGION" \
    --profile "$AWS_PROFILE" 2>/dev/null)"; then
    account_count="$(jq -r '[.Items[].discordUserId.S] | unique | length' <<<"$account_json")"
    daily_active_users="$(jq -r --arg cutoff "$start_time" '[.Items[] | select((.lastActiveAt.S // "") >= $cutoff) | .discordUserId.S] | unique | length' <<<"$account_json")"
  else
    account_count="Unavailable"
    daily_active_users="Unavailable"
  fi

  queue_json="$(aws sqs get-queue-attributes \
    --queue-url "$alert_queue_url" \
    --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible ApproximateNumberOfMessagesDelayed \
    --output json \
    --region "$AWS_REGION" \
    --profile "$AWS_PROFILE" 2>/dev/null || echo '{}')"
  pending="$(jq -r '.Attributes.ApproximateNumberOfMessages // "Unavailable"' <<<"$queue_json")"
  in_flight="$(jq -r '.Attributes.ApproximateNumberOfMessagesNotVisible // "Unavailable"' <<<"$queue_json")"
  delayed="$(jq -r '.Attributes.ApproximateNumberOfMessagesDelayed // "Unavailable"' <<<"$queue_json")"
  queue_json="$(aws sqs get-queue-attributes \
    --queue-url "$dead_letter_queue_url" \
    --attribute-names ApproximateNumberOfMessages \
    --output json \
    --region "$AWS_REGION" \
    --profile "$AWS_PROFILE" 2>/dev/null || echo '{}')"
  dead_letters="$(jq -r '.Attributes.ApproximateNumberOfMessages // "Unavailable"' <<<"$queue_json")"

  monitor_json="$(aws dynamodb get-item \
    --table-name "$table_name" \
    --key '{"PK":{"S":"SYSTEM#MONITOR"},"SK":{"S":"LAST_RUN"}}' \
    --consistent-read \
    --output json \
    --region "$AWS_REGION" \
    --profile "$AWS_PROFILE" 2>/dev/null || echo '{}')"
  monitor_status="$(jq -r '.Item.status.S // "unknown"' <<<"$monitor_json")"
  monitor_completed="$(jq -r '.Item.completedAt.S // empty' <<<"$monitor_json")"
  monitor_checked="$(jq -r '.Item.checked.N // "0"' <<<"$monitor_json")"
  monitor_groups="$(jq -r '.Item.groups.N // "0"' <<<"$monitor_json")"
  monitor_processed="$(jq -r '.Item.processedGroups.N // "0"' <<<"$monitor_json")"
  monitor_deferred="$(jq -r '.Item.deferredGroups.N // "0"' <<<"$monitor_json")"
  monitor_failed_groups="$(jq -r '.Item.failedGroups.N // "0"' <<<"$monitor_json")"
  monitor_alerts="$(jq -r '.Item.alertsQueued.N // "0"' <<<"$monitor_json")"
  monitor_removed="$(jq -r '.Item.removed.N // "0"' <<<"$monitor_json")"
  monitor_interval="$(jq -r '.Item.intervalMinutes.N // "0"' <<<"$monitor_json")"

  metric_queries="$(jq -nc \
    --arg api "$api_function" \
    --arg monitor "$monitor_function" \
    --arg notifier "$notifier_function" \
    --arg interactions "$interactions_function" \
    --arg operations "$operations_function" '
      def metric($id; $function; $name): {
        Id: $id,
        MetricStat: {
          Metric: {
            Namespace: "AWS/Lambda",
            MetricName: $name,
            Dimensions: [{Name: "FunctionName", Value: $function}]
          },
          Period: 86400,
          Stat: "Sum"
        },
        ReturnData: true
      };
      [
        metric("apiinv"; $api; "Invocations"), metric("apierr"; $api; "Errors"),
        metric("moninv"; $monitor; "Invocations"), metric("monerr"; $monitor; "Errors"),
        metric("notinv"; $notifier; "Invocations"), metric("noterr"; $notifier; "Errors"),
        metric("intinv"; $interactions; "Invocations"), metric("interr"; $interactions; "Errors"),
        metric("opsinv"; $operations; "Invocations"), metric("opserr"; $operations; "Errors")
      ]
    ')"
  metric_data="$(aws cloudwatch get-metric-data \
    --metric-data-queries "$metric_queries" \
    --start-time "$start_time" \
    --end-time "$end_time" \
    --scan-by TimestampDescending \
    --output json \
    --region "$AWS_REGION" \
    --profile "$AWS_PROFILE" 2>/dev/null || echo '{"MetricDataResults":[]}')"

  budget_json="$(aws budgets describe-budget \
    --account-id "$account_id" \
    --budget-name coursesnag-annual-cost-ceiling \
    --output json \
    --region "$AWS_REGION" \
    --profile "$AWS_PROFILE" 2>/dev/null || echo '{}')"
  budget_limit="$(jq -r '.Budget.BudgetLimit.Amount // empty' <<<"$budget_json")"
  actual_spend="$(jq -r '.Budget.CalculatedSpend.ActualSpend.Amount // empty' <<<"$budget_json")"
  forecast_spend="$(jq -r '.Budget.CalculatedSpend.ForecastedSpend.Amount // empty' <<<"$budget_json")"

  echo "CourseSnag status"
  echo
  echo "Monitoring"
  echo "  Status: $mode_label"
  echo "  Monitor schedule: $schedule_label"
  if [[ "$health_code" == "200" ]]; then
    printf '  API: Healthy (HTTP 200, %.2fs)\n' "${health_seconds:-0}"
  else
    echo "  API: Unavailable${health_code:+ (HTTP $health_code)}"
  fi
  echo
  echo "Discord data"
  echo "  Linked Discord accounts: $account_count"
  echo "  Active trackers: $tracker_count"
  if [[ -n "$monitor_completed" ]]; then
    echo "  Last monitor run: $monitor_completed"
    echo "    Status: $monitor_status | Interval: ${monitor_interval}m | Checked: $monitor_checked | Groups: $monitor_processed/$monitor_groups | Deferred: $monitor_deferred | Failed: $monitor_failed_groups | Removed: $monitor_removed | Alerts queued: $monitor_alerts"
    if [[ "$monitor_failed_groups" =~ ^[0-9]+$ ]] && (( monitor_failed_groups > 0 )); then
      echo "    Attention: At least one Cornell roster/subject group failed."
    fi
    if [[ "$monitor_deferred" =~ ^[0-9]+$ ]] && (( monitor_deferred > 0 )); then
      echo "    Attention: The next run will rotate to the deferred groups first."
    fi
  else
    echo "  Last monitor run: No detailed run recorded yet"
  fi
  echo
  echo "Alert delivery"
  echo "  Pending: $pending | In flight: $in_flight | Delayed: $delayed | Dead-lettered: $dead_letters"
  if [[ "$dead_letters" =~ ^[0-9]+$ ]] && (( dead_letters > 0 )); then
    echo "  Attention: Dead-lettered alerts require inspection; do not replay them blindly."
  fi
  echo
  echo "Metrics (last 24 hours)"
  echo "  Daily active users: $daily_active_users"
  echo "  API:          $(metric_total "$metric_data" apiinv) invocations | $(metric_total "$metric_data" apierr) errors"
  echo "  Monitor:      $(metric_total "$metric_data" moninv) invocations | $(metric_total "$metric_data" monerr) errors"
  echo "  Notifier:     $(metric_total "$metric_data" notinv) invocations | $(metric_total "$metric_data" noterr) errors"
  echo "  Interactions: $(metric_total "$metric_data" intinv) invocations | $(metric_total "$metric_data" interr) errors"
  echo "  Operations:   $(metric_total "$metric_data" opsinv) invocations | $(metric_total "$metric_data" opserr) errors"
  echo
  echo "Cost"
  if [[ -n "$budget_limit" && -n "$actual_spend" ]]; then
    printf '  Annual budget: $%.2f used of $%.2f\n' "$actual_spend" "$budget_limit"
    if [[ -n "$forecast_spend" ]]; then
      printf '  Forecast: $%.2f\n' "$forecast_spend"
    else
      echo "  Forecast: Not available yet"
    fi
    echo "  Note: AWS billing totals can take about 24 hours to update."
  else
    echo "  Budget data: Unavailable"
  fi
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

invoke_monitor_now() {
  local result_file
  result_file="$(mktemp)"
  aws lambda invoke \
    --function-name "$MONITOR_FUNCTION" \
    --invocation-type Event \
    --cli-binary-format raw-in-base64-out \
    --payload '{"force":true,"trigger":"discord-active-start"}' \
    --region "$AWS_REGION" \
    --profile "$AWS_PROFILE" \
    "$result_file" >/dev/null
  rm -f "$result_file"
}

configure_discord() {
  "$PROJECT_ROOT/scripts/configure-discord.sh" "$1"
}

set_function_enabled() {
  local logical_id="$1"
  local enabled="$2"
  local function_name reserved_concurrency
  function_name="$(stack_resource "$logical_id")"

  if [[ "$enabled" == "true" ]]; then
    reserved_concurrency="$(aws lambda get-function-concurrency \
      --function-name "$function_name" \
      --query ReservedConcurrentExecutions \
      --output text \
      --region "$AWS_REGION" \
      --profile "$AWS_PROFILE")"
    if [[ "$reserved_concurrency" == "0" ]]; then
      aws lambda delete-function-concurrency \
        --function-name "$function_name" \
        --region "$AWS_REGION" \
        --profile "$AWS_PROFILE"
    fi
  else
    aws lambda put-function-concurrency \
      --function-name "$function_name" \
      --reserved-concurrent-executions 0 \
      --region "$AWS_REGION" \
      --profile "$AWS_PROFILE" >/dev/null
  fi
}

set_request_functions_enabled() {
  local enabled="$1"
  set_function_enabled ApiFunction "$enabled"
  set_function_enabled InteractionsFunction "$enabled"
}

case "$ACTION" in
  start)
    PREVIOUS_MODE="$(current_mode)"
    if [[ "$PREVIOUS_MODE" == "cloud" ]]; then
      set_request_functions_enabled true
      aws events enable-rule \
        --name "$RULE_NAME" \
        --region "$AWS_REGION" \
        --profile "$AWS_PROFILE"
      configure_discord online
      echo "CourseSnag is already in Discord Active mode. No Discord alert was sent; /tracked is available and the application description confirms Status: ONLINE."
      exit 0
    fi
    aws ssm put-parameter \
      --name "$MODE_PARAMETER" \
      --type String \
      --value starting \
      --overwrite \
      --region "$AWS_REGION" \
      --profile "$AWS_PROFILE" >/dev/null
    announce_season_status "announce-season-online"
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
    set_request_functions_enabled true
    configure_discord online
    invoke_monitor_now
    echo "CourseSnag is in Discord Active mode. An immediate monitor run was queued; later checks follow the adaptive 5/10/30-minute schedule. /tracked is available and the application description shows Status: ONLINE."
    ;;
  stop)
    PREVIOUS_MODE="$(current_mode)"
    if [[ "$PREVIOUS_MODE" == "local" ]]; then
      aws events disable-rule \
        --name "$RULE_NAME" \
        --region "$AWS_REGION" \
        --profile "$AWS_PROFILE"
      set_request_functions_enabled false
      configure_discord offline
      echo "CourseSnag is already in Local Standby mode. No Discord alert was sent; /tracked is unavailable and the application description confirms Status: OFFLINE."
      exit 0
    fi
    aws ssm put-parameter \
      --name "$MODE_PARAMETER" \
      --type String \
      --value stopping \
      --overwrite \
      --region "$AWS_REGION" \
      --profile "$AWS_PROFILE" >/dev/null
    aws events disable-rule \
      --name "$RULE_NAME" \
      --region "$AWS_REGION" \
      --profile "$AWS_PROFILE"
    announce_season_status "announce-season-offline"
    aws ssm put-parameter \
      --name "$MODE_PARAMETER" \
      --type String \
      --value local \
      --overwrite \
      --region "$AWS_REGION" \
      --profile "$AWS_PROFILE" >/dev/null
    set_request_functions_enabled false
    configure_discord offline
    echo "CourseSnag is in Local Standby mode. Scheduled AWS polling and /tracked are disabled, and the application description shows Status: OFFLINE."
    ;;
  status)
    show_status
    ;;
  *)
    echo "Usage: $0 {start|stop|status}" >&2
    exit 1
    ;;
esac
