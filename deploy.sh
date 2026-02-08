#!/bin/bash
set -e

# ============================================
# Russian Tin-Tin Deployment Script
# ============================================

PROJECT_ID="book-friend-finder"
REGION="us-central1"
SERVICE_NAME="russian-transcription"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Russian Tin-Tin Deployment ===${NC}"

# Check if .env exists
if [ ! -f ".env" ]; then
    echo -e "${RED}Error: .env file not found${NC}"
    echo "Create .env with OPENAI_API_KEY and GOOGLE_TRANSLATE_API_KEY"
    exit 1
fi

# Load .env
source .env

if [ -z "$OPENAI_API_KEY" ] || [ -z "$GOOGLE_TRANSLATE_API_KEY" ]; then
    echo -e "${RED}Error: Missing API keys in .env${NC}"
    exit 1
fi

# Set project
echo -e "${YELLOW}Setting project to ${PROJECT_ID}...${NC}"
gcloud config set project $PROJECT_ID

# ============================================
# Step 1: Enable required APIs
# ============================================
echo -e "${YELLOW}Enabling APIs...${NC}"
gcloud services enable \
    run.googleapis.com \
    cloudbuild.googleapis.com \
    secretmanager.googleapis.com \
    translate.googleapis.com \
    storage.googleapis.com \
    --quiet

# ============================================
# Step 1b: Set up GCS bucket for video storage
# ============================================
GCS_BUCKET="russian-transcription-videos"
echo -e "${YELLOW}Setting up GCS bucket...${NC}"

# Create bucket if it doesn't exist
if ! gsutil ls -b gs://${GCS_BUCKET} &>/dev/null; then
    echo "Creating bucket gs://${GCS_BUCKET}..."
    gsutil mb -l ${REGION} gs://${GCS_BUCKET}
    # Set lifecycle rule to delete videos after 7 days
    cat > /tmp/lifecycle.json << EOF
{
  "rule": [
    {
      "action": {"type": "Delete"},
      "condition": {"age": 7}
    }
  ]
}
EOF
    gsutil lifecycle set /tmp/lifecycle.json gs://${GCS_BUCKET}
    rm /tmp/lifecycle.json
else
    echo "Bucket gs://${GCS_BUCKET} already exists"
fi

# Get Cloud Run service account
SA_EMAIL="${PROJECT_ID}@appspot.gserviceaccount.com"
# Also check for the compute service account used by Cloud Run
COMPUTE_SA=$(gcloud iam service-accounts list --filter="displayName:Compute Engine default service account" --format="value(email)" 2>/dev/null || true)

echo "Granting storage permissions to service accounts..."
gsutil iam ch serviceAccount:${SA_EMAIL}:objectAdmin gs://${GCS_BUCKET} 2>/dev/null || true
if [ -n "$COMPUTE_SA" ]; then
    gsutil iam ch serviceAccount:${COMPUTE_SA}:objectAdmin gs://${GCS_BUCKET} 2>/dev/null || true
fi

# ============================================
# Step 2: Set up secrets
# ============================================
echo -e "${YELLOW}Setting up secrets...${NC}"

# Create or update OPENAI_API_KEY secret
if gcloud secrets describe openai-api-key &>/dev/null; then
    echo "Updating openai-api-key secret..."
    echo -n "$OPENAI_API_KEY" | gcloud secrets versions add openai-api-key --data-file=-
else
    echo "Creating openai-api-key secret..."
    echo -n "$OPENAI_API_KEY" | gcloud secrets create openai-api-key --data-file=-
fi

# Create or update GOOGLE_TRANSLATE_API_KEY secret
if gcloud secrets describe google-translate-key &>/dev/null; then
    echo "Updating google-translate-key secret..."
    echo -n "$GOOGLE_TRANSLATE_API_KEY" | gcloud secrets versions add google-translate-key --data-file=-
else
    echo "Creating google-translate-key secret..."
    echo -n "$GOOGLE_TRANSLATE_API_KEY" | gcloud secrets create google-translate-key --data-file=-
fi

# ============================================
# Step 3: Deploy backend to Cloud Run
# ============================================
echo -e "${YELLOW}Deploying backend to Cloud Run...${NC}"

cd server

gcloud run deploy $SERVICE_NAME \
    --source . \
    --region $REGION \
    --platform managed \
    --allow-unauthenticated \
    --set-secrets="OPENAI_API_KEY=openai-api-key:latest,GOOGLE_TRANSLATE_API_KEY=google-translate-key:latest" \
    --set-env-vars="GCS_BUCKET=${GCS_BUCKET}" \
    --memory 1Gi \
    --timeout 300 \
    --quiet

cd ..

# Get the Cloud Run URL
BACKEND_URL=$(gcloud run services describe $SERVICE_NAME --region $REGION --format 'value(status.url)')
echo -e "${GREEN}Backend deployed at: ${BACKEND_URL}${NC}"

# ============================================
# Step 4: Build frontend with backend URL
# ============================================
echo -e "${YELLOW}Building frontend...${NC}"

# Create production env file for frontend
echo "VITE_API_URL=${BACKEND_URL}" > .env.production

npm run build

# ============================================
# Step 5: Deploy frontend to Firebase Hosting
# ============================================
echo -e "${YELLOW}Deploying frontend to Firebase Hosting...${NC}"

# Initialize Firebase if not already done
if [ ! -f "firebase.json" ]; then
    echo -e "${YELLOW}Initializing Firebase...${NC}"
    cat > firebase.json << EOF
{
  "hosting": {
    "public": "dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [
      {
        "source": "**",
        "destination": "/index.html"
      }
    ]
  }
}
EOF
fi

# Create .firebaserc if not exists
if [ ! -f ".firebaserc" ]; then
    cat > .firebaserc << EOF
{
  "projects": {
    "default": "${PROJECT_ID}"
  }
}
EOF
fi

firebase deploy --only hosting

echo ""
echo -e "${GREEN}=== Deployment Complete ===${NC}"
echo -e "Backend API: ${BACKEND_URL}"
echo -e "Frontend: https://${PROJECT_ID}.web.app"
echo ""
