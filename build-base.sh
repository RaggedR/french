#!/bin/bash
set -e

# Build and push the base image using Cloud Build
# Run this rarely - only when yt-dlp/ffmpeg needs updating

echo "Building base image with Cloud Build..."
cd server
gcloud builds submit --tag gcr.io/book-friend-finder/russian-base:latest --dockerfile Dockerfile.base

echo "Done! Base image updated."
