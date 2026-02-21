#!/bin/bash
set -e

# Quick deploy - uses local Docker for fast builds (~15-20s)

IMAGE="gcr.io/russian-transcription/russian-transcription"
GCS_BUCKET="russian-transcription-videos"
MAX_INSTANCES=1  # Cap Cloud Run scaling to control costs (change as needed)

# Ensure GCS bucket exists
if ! gsutil ls -b gs://${GCS_BUCKET} &>/dev/null; then
    echo "Creating GCS bucket..."
    gsutil mb -l us-central1 gs://${GCS_BUCKET}
    # Allow public read for video files
    gsutil iam ch allUsers:objectViewer gs://${GCS_BUCKET}
fi

echo "Building frontend..."
npm run build

echo "Copying dist to server..."
cp -r dist server/

echo "Building Docker image locally..."
cd server
docker build --platform linux/amd64 -t $IMAGE:latest .

echo "Pushing to GCR..."
docker push $IMAGE:latest

echo "Deploying to Cloud Run..."
gcloud run deploy russian-transcription \
    --image $IMAGE:latest \
    --region us-central1 \
    --allow-unauthenticated \
    --memory 1Gi \
    --timeout 300 \
    --max-instances $MAX_INSTANCES \
    --set-secrets="OPENAI_API_KEY=openai-api-key:latest,GOOGLE_TRANSLATE_API_KEY=google-translate-key:latest,STRIPE_SECRET_KEY=stripe-secret-key:latest,STRIPE_WEBHOOK_SECRET=stripe-webhook-secret:latest,STRIPE_PRICE_ID=stripe-price-id:latest" \
    --set-env-vars="GCS_BUCKET=russian-transcription-videos"

echo "Cleaning up old Docker images..."
OLD_DIGESTS=$(gcloud container images list-tags $IMAGE --filter="NOT tags:latest" --format="value(digest)" 2>/dev/null)
if [ -n "$OLD_DIGESTS" ]; then
    for digest in $OLD_DIGESTS; do
        gcloud container images delete "$IMAGE@sha256:$digest" --quiet --force-delete-tags 2>/dev/null || true
    done
    echo "Cleanup complete."
else
    echo "No old images to clean up."
fi

echo "Done!"
