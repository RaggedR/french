# API Usage & Cost Controls

## OpenAI Services

| Service | Model | Cost | Used For |
|---------|-------|------|----------|
| Whisper | whisper-1 | $0.006/min audio | Transcribing Russian video audio |
| GPT-4o | gpt-4o | ~$0.025/call | Punctuation correction, word lemmatization |
| GPT-4o-mini | gpt-4o-mini | ~$0.002/call | Sentence extraction for flashcards |
| TTS | tts-1 | $15/1M characters | Text mode audio generation (lib.ru) |

## Rate Limits (per user, per minute)

| Endpoint | Limit | What It Does |
|----------|-------|--------------|
| POST /api/analyze | 3/min + 5/day | Whisper + GPT-4o + yt-dlp (most expensive) |
| POST /api/load-more-chunks | 3/min | Same pipeline for long videos |
| POST /api/download-chunk | 10/min | yt-dlp + GPT-4o lemmatize |
| POST /api/translate | 60/min | Google Translate (not OpenAI) |
| POST /api/extract-sentence | 10/min | GPT-4o-mini sentence extraction |

## Per-User Cost Limits

### OpenAI

| Window | Limit | Resets |
|--------|-------|--------|
| Daily | $1 | Midnight UTC |
| Weekly | $5 | Monday (ISO week) |
| Monthly | $10 | 1st of month |

### Google Translate

| Window | Limit | Resets |
|--------|-------|--------|
| Daily | $0.50 | Midnight UTC |
| Weekly | $2.50 | Monday (ISO week) |
| Monthly | $5 | 1st of month |

Tracked in-memory in `server/usage.js`. Resets on server restart (Cloud Run cold start). Cache hits (repeated word lookups) don't count toward translate costs.

## Cloud Run Scaling

**Current setting: `--max-instances 1`**

This caps Cloud Run to a single container, limiting costs to ~$0.10/hour max. Concurrent requests queue instead of spinning up new instances.

To change, edit the `MAX_INSTANCES` variable at the top of `quick-deploy.sh` or `deploy.sh`, then redeploy. Or update immediately without redeploying:

```bash
# Set to 3 instances (handles more concurrent users)
gcloud run services update russian-transcription --region us-central1 --max-instances 3

# Uncap entirely (not recommended without billing alerts)
gcloud run services update russian-transcription --region us-central1 --max-instances 0
```

| Max Instances | Max Cloud Run Cost/hour | Good For |
|---------------|------------------------|----------|
| 1 | ~$0.10 | Just you / a few users |
| 3 | ~$0.30 | Small group (~10 users) |
| 5 | ~$0.50 | Larger group |

## GCP Services & Free Tiers

| Service | What It Does | Free Tier (per month) |
|---------|-------------|----------------------|
| Cloud Run | Hosts the Express server | 2M requests, 360K GB-sec memory, 180K vCPU-sec |
| Cloud Storage (GCS) | Videos + sessions in production | 5 GB storage, 5K writes, 50K reads, 1 GB egress |
| Firestore | Flashcard deck persistence | 50K reads/day, 20K writes/day, 1 GB storage |
| Secret Manager | Stores OpenAI + Google Translate keys | 6 active versions, 10K access ops |
| Container Registry | Docker images (uses GCS storage) | Counts toward GCS storage |
| Google Translate API | Word translation | No free tier — pay from first character (tracked in-app) |

**Will never exceed free tier:** Secret Manager (2 secrets, accessed on deploy only).

### Risk 1: Cloud Storage (5 GB free)

Video chunks are ~10 MB each. 10 users × 3 videos × 3 chunks = ~900 MB. Mitigated by the **7-day lifecycle policy** in `deploy.sh` — files auto-delete after a week, so storage won't grow forever. After free tier: ~$0.02/GB/month.

### Risk 2: Network Egress (1 GB/month free)

Every time a user streams a video chunk from GCS, that's outbound data. 1 GB free tier = ~100 chunk plays/month. After that: $0.12/GB. This is the harder one to control — repeated rewatching of the same videos burns through egress without hitting any of the app-level rate limits.

### Risk 3: Container Registry (counts toward GCS storage)

Each Docker image is ~500 MB. Every deploy pushes a new image. After 10 deploys that's 5 GB eating into the Cloud Storage free tier. Mitigated by **automatic cleanup** — both `quick-deploy.sh` and `deploy.sh` delete old untagged images after each deploy. Only the `latest` image (and its referenced layers) is kept.

## GCP Budget Alert Setup

Set up at: **console.cloud.google.com** → Billing → Budgets & alerts

1. Go to https://console.cloud.google.com/billing
2. Select the billing account linked to project `russian-transcription`
3. Click **Budgets & alerts** in the left sidebar
4. Click **Create Budget**
5. Name: "russian-transcription free tier alert"
6. Scope: project `russian-transcription`
7. Budget amount: **$0.01** (triggers on any paid usage beyond free tier)
8. Alert thresholds: **50%, 90%, 100%**
9. Notification recipients: your email
10. Click **Finish**

## Emergency: Kill All OpenAI Spending

### Option 1: Revoke API Key (instant, ~30 seconds)
1. Go to https://platform.openai.com → API Keys
2. Click the trash icon next to the key → confirm
3. All API calls fail immediately across all instances
4. When ready: create a new key, then update GCP secret:
   ```bash
   echo -n "sk-NEW-KEY-HERE" | gcloud secrets versions add openai-api-key --data-file=-
   gcloud run services update russian-transcription --region us-central1 --set-secrets="OPENAI_API_KEY=openai-api-key:latest"
   ```

### Option 2: Set OpenAI Budget to $0 (instant, ~30 seconds)
1. Go to https://platform.openai.com → Settings → Limits
2. Set monthly budget cap to $0
3. Same effect as revoking, but keeps the key intact
4. When ready: raise the limit back
