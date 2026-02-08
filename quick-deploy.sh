#!/bin/bash
set -e

# Quick deploy - uses local Docker for fast builds (~15-20s)

IMAGE="gcr.io/book-friend-finder/russian-transcription"
GCS_BUCKET="russian-transcription-videos"

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
    --set-secrets="OPENAI_API_KEY=openai-api-key:latest,GOOGLE_TRANSLATE_API_KEY=google-translate-key:latest" \
    --set-env-vars="GCS_BUCKET=russian-transcription-videos"

echo "Done!"
