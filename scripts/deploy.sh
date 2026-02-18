#!/bin/bash
set -euo pipefail

# Deploy russian-transcription to Cloud Run
#
# Prerequisites (handled by ci.yml before calling this script):
#   - Node.js installed, npm ci done
#   - Authenticated to GCP (google-github-actions/auth)
#   - gcloud CLI configured
#   - Docker configured for GCR (gcloud auth configure-docker)
#
# Required env vars (set by ci.yml from GitHub secrets):
#   VITE_FIREBASE_*        — Firebase config for frontend build
#   VITE_SENTRY_DSN        — Sentry DSN for frontend
#   SENTRY_AUTH_TOKEN       — Sentry source map upload
#   SENTRY_ORG, SENTRY_PROJECT — Sentry org/project
#   GIT_SHA                — Commit SHA for release tagging
#
# To run locally (after gcloud auth login):
#   GIT_SHA=$(git rev-parse HEAD) ./scripts/deploy.sh

GIT_SHA="${GIT_SHA:-$(git rev-parse HEAD)}"
SHORT_SHA="${GIT_SHA:0:7}"
IMAGE="gcr.io/russian-transcription/russian-transcription"
SERVICE="russian-transcription"
REGION="us-central1"

echo "=== Deploying $SERVICE ($SHORT_SHA) ==="

# 1. Get current Cloud Run URL for frontend build
echo "--- Getting Cloud Run URL ---"
BACKEND_URL=$(gcloud run services describe "$SERVICE" \
  --region "$REGION" \
  --format 'value(status.url)' 2>/dev/null || echo "")

# 2. Build frontend with production env vars
echo "--- Building frontend ---"
cat > .env.production << EOF
VITE_API_URL=$BACKEND_URL
VITE_SENTRY_DSN=${VITE_SENTRY_DSN:-}
VITE_GIT_SHA=$GIT_SHA
EOF
npm run build

# 3. Copy frontend into server
echo "--- Preparing server ---"
cp -r dist server/

# 4. Build and push Docker image
echo "--- Building Docker image ---"
cd server
docker build --platform linux/amd64 \
  -t "$IMAGE:latest" \
  -t "$IMAGE:$GIT_SHA" \
  -t "$IMAGE:$SHORT_SHA" \
  .
docker push "$IMAGE:latest"
docker push "$IMAGE:$GIT_SHA"
docker push "$IMAGE:$SHORT_SHA"
cd ..

# 5. Deploy to Cloud Run
echo "--- Deploying to Cloud Run ---"
gcloud run deploy "$SERVICE" \
  --image "$IMAGE:latest" \
  --region "$REGION" \
  --allow-unauthenticated \
  --memory 1Gi \
  --timeout 300 \
  --max-instances 1 \
  --set-secrets="OPENAI_API_KEY=openai-api-key:latest,GOOGLE_TRANSLATE_API_KEY=google-translate-key:latest,SENTRY_DSN=sentry-dsn:latest" \
  --set-env-vars="GCS_BUCKET=russian-transcription-videos,GIT_SHA=$GIT_SHA"

# 6. Verify deployment
echo "--- Verifying deployment ---"
DEPLOY_URL=$(gcloud run services describe "$SERVICE" \
  --region "$REGION" \
  --format 'value(status.url)')
echo "Deployed to: $DEPLOY_URL"
curl -sf "$DEPLOY_URL/api/health" || echo "Health check pending (cold start)"

echo "=== Deploy complete ($SHORT_SHA) ==="
