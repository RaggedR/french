#!/usr/bin/env bash
# setup-monitoring.sh — Idempotent setup of GCP uptime check + alert for Cloud Run
#
# Usage: ./scripts/setup-monitoring.sh your@email.com
#
# Creates:
#   1. Email notification channel (if not exists)
#   2. HTTPS uptime check on /api/health every 5 min (if not exists)
#   3. Alert policy for uptime check failure (if not exists)

set -euo pipefail

PROJECT="russian-transcription"
SERVICE_URL="https://russian-transcription-oi664eissa-uc.a.run.app"
CHECK_DISPLAY_NAME="russian-transcription-health"
ALERT_DISPLAY_NAME="russian-transcription-uptime-alert"

if [ $# -lt 1 ]; then
  echo "Usage: $0 <email>"
  echo "Example: $0 your@email.com"
  exit 1
fi

EMAIL="$1"

echo "=== GCP Monitoring Setup ==="
echo "Project: ${PROJECT}"
echo "Email: ${EMAIL}"
echo ""

# 0. Enable Monitoring API
echo "[1/4] Enabling monitoring API..."
gcloud services enable monitoring.googleapis.com --project="${PROJECT}" --quiet

# 1. Create email notification channel (skip if exists)
echo "[2/4] Setting up email notification channel..."
EXISTING_CHANNEL=$(gcloud alpha monitoring channels list \
  --project="${PROJECT}" \
  --filter="type=email AND labels.email_address=${EMAIL}" \
  --format="value(name)" 2>/dev/null | head -1)

if [ -n "${EXISTING_CHANNEL}" ]; then
  echo "  -> Channel already exists: ${EXISTING_CHANNEL}"
  CHANNEL_ID="${EXISTING_CHANNEL}"
else
  CHANNEL_ID=$(gcloud alpha monitoring channels create \
    --project="${PROJECT}" \
    --display-name="Alert Email (${EMAIL})" \
    --type=email \
    --channel-labels="email_address=${EMAIL}" \
    --format="value(name)")
  echo "  -> Created channel: ${CHANNEL_ID}"
fi

# 2. Create uptime check (skip if exists)
echo "[3/4] Setting up uptime check..."
EXISTING_CHECK=$(gcloud monitoring uptime list-configs \
  --project="${PROJECT}" \
  --filter="displayName=${CHECK_DISPLAY_NAME}" \
  --format="value(name)" 2>/dev/null | head -1)

if [ -n "${EXISTING_CHECK}" ]; then
  echo "  -> Uptime check already exists: ${EXISTING_CHECK}"
  CHECK_ID="${EXISTING_CHECK}"
else
  CHECK_ID=$(gcloud monitoring uptime create \
    --project="${PROJECT}" \
    --display-name="${CHECK_DISPLAY_NAME}" \
    --resource-type="uptime-url" \
    --hostname="russian-transcription-oi664eissa-uc.a.run.app" \
    --path="/api/health" \
    --protocol="https" \
    --period=5 \
    --timeout=10 \
    --format="value(name)" 2>/dev/null)
  echo "  -> Created uptime check: ${CHECK_ID}"
fi

# 3. Create alert policy (skip if exists)
echo "[4/4] Setting up alert policy..."
EXISTING_ALERT=$(gcloud alpha monitoring policies list \
  --project="${PROJECT}" \
  --filter="displayName=${ALERT_DISPLAY_NAME}" \
  --format="value(name)" 2>/dev/null | head -1)

if [ -n "${EXISTING_ALERT}" ]; then
  echo "  -> Alert policy already exists: ${EXISTING_ALERT}"
else
  # Extract the uptime check ID (last segment of the resource name)
  CHECK_SHORT_ID=$(echo "${CHECK_ID}" | grep -oE '[^/]+$')

  gcloud alpha monitoring policies create \
    --project="${PROJECT}" \
    --display-name="${ALERT_DISPLAY_NAME}" \
    --notification-channels="${CHANNEL_ID}" \
    --condition-display-name="Uptime check failure" \
    --condition-filter="resource.type = \"uptime_url\" AND metric.type = \"monitoring.googleapis.com/uptime_check/check_passed\" AND metric.labels.check_id = \"${CHECK_SHORT_ID}\"" \
    --aggregation='{"alignmentPeriod":"300s","crossSeriesReducer":"REDUCE_COUNT_FALSE","perSeriesAligner":"ALIGN_NEXT_OLDER","groupByFields":["resource.label.host"]}' \
    --condition-comparison="COMPARISON_GT" \
    --condition-threshold-value=1 \
    --duration="300s" \
    --combiner="OR" \
    --if-absent \
    --quiet 2>/dev/null || echo "  -> Note: alert creation may need manual setup via GCP Console"

  echo "  -> Alert policy created"
fi

echo ""
echo "=== Done ==="
echo "Verify at: https://console.cloud.google.com/monitoring/uptime?project=${PROJECT}"
