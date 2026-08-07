#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SETTINGS_FILE="$PROJECT_ROOT/infra/parameters.local.env"

if [[ ! -f "$SETTINGS_FILE" ]]; then
  echo "Missing $SETTINGS_FILE. Copy .env.example values into that ignored file first." >&2
  exit 1
fi

set -a
source "$SETTINGS_FILE"
set +a

: "${AWS_PROFILE:=coursesnag}"
: "${AWS_REGION:=us-east-1}"
: "${STACK_NAME:=coursesnag-dev}"
: "${STAGE_NAME:=dev}"
: "${ALLOWED_ORIGIN:=https://coursesnag.pages.dev}"
: "${DISCORD_APPLICATION_ID:?DISCORD_APPLICATION_ID is required}"
: "${BUDGET_ALERT_EMAIL:?Add BUDGET_ALERT_EMAIL to infra/parameters.local.env before deployment}"

ACCOUNT_ID="$(aws sts get-caller-identity --profile "$AWS_PROFILE" --query Account --output text)"
CALLER_ARN="$(aws sts get-caller-identity --profile "$AWS_PROFILE" --query Arn --output text)"

if [[ "$CALLER_ARN" == *":root" ]]; then
  echo "Refusing to deploy with the AWS root identity." >&2
  exit 1
fi

ARTIFACT_BUCKET="coursesnag-artifacts-${ACCOUNT_ID}-${AWS_REGION}"

if ! aws s3api head-bucket --bucket "$ARTIFACT_BUCKET" --profile "$AWS_PROFILE" >/dev/null 2>&1; then
  aws s3api create-bucket \
    --bucket "$ARTIFACT_BUCKET" \
    --region "$AWS_REGION" \
    --profile "$AWS_PROFILE" >/dev/null
fi

aws s3api put-public-access-block \
  --bucket "$ARTIFACT_BUCKET" \
  --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true \
  --profile "$AWS_PROFILE" >/dev/null

aws s3api put-bucket-encryption \
  --bucket "$ARTIFACT_BUCKET" \
  --server-side-encryption-configuration \
    'Rules=[{ApplyServerSideEncryptionByDefault={SSEAlgorithm=AES256}}]' \
  --profile "$AWS_PROFILE" >/dev/null

aws s3api put-bucket-lifecycle-configuration \
  --bucket "$ARTIFACT_BUCKET" \
  --lifecycle-configuration "file://$PROJECT_ROOT/infra/artifact-lifecycle.json" \
  --profile "$AWS_PROFILE" >/dev/null

mkdir -p "$PROJECT_ROOT/build"

npm --prefix "$PROJECT_ROOT/backend" ci --omit=dev

aws cloudformation package \
  --template-file "$PROJECT_ROOT/infra/template.yaml" \
  --s3-bucket "$ARTIFACT_BUCKET" \
  --s3-prefix "$STACK_NAME" \
  --output-template-file "$PROJECT_ROOT/build/packaged.yaml" \
  --region "$AWS_REGION" \
  --profile "$AWS_PROFILE"

aws cloudformation validate-template \
  --template-body "file://$PROJECT_ROOT/build/packaged.yaml" \
  --region "$AWS_REGION" \
  --profile "$AWS_PROFILE" >/dev/null

aws cloudformation deploy \
  --template-file "$PROJECT_ROOT/build/packaged.yaml" \
  --stack-name "$STACK_NAME" \
  --capabilities CAPABILITY_IAM \
  --no-fail-on-empty-changeset \
  --parameter-overrides \
    StageName="$STAGE_NAME" \
    AllowedOrigin="$ALLOWED_ORIGIN" \
    DiscordApplicationId="$DISCORD_APPLICATION_ID" \
    BudgetAlertEmail="$BUDGET_ALERT_EMAIL" \
    AnnualBudgetAmount=50 \
  --tags Project=CourseSnag Environment="$STAGE_NAME" \
  --region "$AWS_REGION" \
  --profile "$AWS_PROFILE"

aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query 'Stacks[0].Outputs[].{Name:OutputKey,Value:OutputValue}' \
  --output table \
  --region "$AWS_REGION" \
  --profile "$AWS_PROFILE"
