# System Architecture — Data Flow

## 1. Authentication

```mermaid
sequenceDiagram
    actor User
    participant App as React App
    participant Firebase as Firebase Auth
    participant Server as Express (Cloud Run)

    User->>App: Opens app
    App->>App: onAuthStateChanged(null)
    App->>User: Show LoginScreen
    User->>App: Click "Sign in with Google"
    App->>Firebase: signInWithPopup(GoogleAuthProvider)
    Firebase-->>App: User credential (uid, email, displayName, photoURL)
    App->>App: getIdToken()
    Note over App,Server: All subsequent API calls include<br/>Authorization: Bearer <idToken>
```

## 2. Video Analysis (ok.ru)

```mermaid
sequenceDiagram
    actor User
    participant App as React App
    participant Server as Express (Cloud Run)
    participant ytdlp as yt-dlp
    participant OkRu as ok.ru
    participant OpenAI as OpenAI API
    participant GCS as Cloud Storage

    User->>App: Paste ok.ru URL
    App->>Server: POST /api/analyze {url}
    Note over Server: requireAuth → requireBudget<br/>→ analyzeRateLimit (3/min, 5/day)

    Server->>App: {sessionId}
    App->>Server: SSE /api/progress/:sessionId?token=...

    Server->>ytdlp: getOkRuVideoInfo(url)
    ytdlp->>OkRu: Scrape metadata
    OkRu-->>ytdlp: title, duration
    ytdlp-->>Server: Video info
    Server-->>App: SSE: {step: "extracting", progress: 0.1}

    Server->>ytdlp: downloadAudioChunk(url)
    ytdlp->>OkRu: Download full audio
    OkRu-->>ytdlp: Audio stream
    ytdlp-->>Server: audio.wav
    Note over Server: trackCost(uid, costs.whisper(duration))
    Server-->>App: SSE: {step: "transcribing"}

    Server->>OpenAI: Whisper API (audio.wav)
    OpenAI-->>Server: Words[] with timestamps

    Server->>OpenAI: GPT-4o: addPunctuation(words)
    Note over Server: trackCost(uid, costs.gpt4o())
    OpenAI-->>Server: Punctuated text
    Note over Server: Two-pointer alignment:<br/>map punctuated text back to timestamps

    Server->>Server: smartChunking(words)<br/>Split at >0.5s pauses, ~3-5min each

    alt Production
        Server->>GCS: Save session JSON
    end

    Server-->>App: SSE: {type: "complete", chunks: [...]}

    alt Single chunk
        App->>App: Auto-trigger download
    else Multiple chunks
        App->>User: Show chunk menu
    end
```

## 3. Chunk Download & Playback

```mermaid
sequenceDiagram
    actor User
    participant App as React App
    participant Server as Express (Cloud Run)
    participant ytdlp as yt-dlp
    participant OkRu as ok.ru
    participant OpenAI as OpenAI API
    participant GCS as Cloud Storage

    User->>App: Select chunk (or auto-selected)
    App->>Server: POST /api/download-chunk {sessionId, chunkId}
    Note over Server: requireAuth → requireBudget<br/>→ downloadChunkRateLimit (10/min)

    Server->>ytdlp: downloadVideoChunk(url, startTime, endTime)
    ytdlp->>OkRu: Download video segment
    OkRu-->>ytdlp: Video stream
    ytdlp-->>Server: chunk.mp4

    Server->>OpenAI: GPT-4o: lemmatizeWords(words)
    Note over Server: trackCost(uid, costs.gpt4o())
    OpenAI-->>Server: Words with lemmas

    alt Production
        Server->>GCS: Upload chunk.mp4
        GCS-->>Server: Signed URL
    else Local dev
        Server->>Server: Save to server/temp/
    end

    Server-->>App: {status: "ready"}
    App->>Server: GET /api/session/:id/chunk/:chunkId
    Server-->>App: {videoUrl, transcript: {words, duration}, title}

    Note over App: VideoPlayer.tsx + TranscriptPanel.tsx
    App->>User: Video plays with synced transcript
    Note over App: Words highlight in real-time<br/>based on currentTime vs word timestamps
```

## 4. Word Translation & Flashcards

```mermaid
sequenceDiagram
    actor User
    participant App as React App
    participant Server as Express (Cloud Run)
    participant Google as Google Translate API
    participant OpenAI as OpenAI API
    participant Firestore as Firestore

    User->>App: Click word in transcript
    App->>Server: POST /api/translate {word}
    Note over Server: requireAuth → requireTranslateBudget<br/>→ translateRateLimit (60/min)

    alt Cache hit
        Server-->>App: Cached translation (no API call)
    else Cache miss
        Server->>Google: Translate API (ru → en)
        Note over Server: trackTranslateCost(uid, costs.translate(len))
        Google-->>Server: Translation
        Server->>Server: Cache result
        Server-->>App: {word, translation}
    end

    App->>User: Show popup with translation

    User->>App: Click "Add to Deck" in popup
    App->>Server: POST /api/extract-sentence {text, word}
    Note over Server: requireAuth → requireBudget<br/>→ extractSentenceRateLimit (10/min)
    Server->>OpenAI: GPT-4o-mini: extract sentence + translate
    Note over Server: trackCost(uid, costs.gpt4oMini())
    OpenAI-->>Server: {sentence, translation}
    Server-->>App: Sentence context

    App->>App: useDeck: add SRS card<br/>(word, translation, sentence, context)
    App->>Firestore: Save deck (debounced 500ms)

    Note over App: Card uses SM-2 algorithm<br/>Learning steps: 1min → 5min → graduated
```

## 5. Flashcard Review

```mermaid
sequenceDiagram
    actor User
    participant App as React App
    participant Firestore as Firestore

    User->>App: Click deck badge / review button
    App->>App: Filter cards due for review<br/>(card.nextReview ≤ now)
    App->>User: Show ReviewPanel (front of card)

    User->>App: Press Space (reveal answer)
    App->>User: Show back of card<br/>(translation + sentence context)

    User->>App: Rate: 1(Again) / 2(Hard) / 3(Good) / 4(Easy)
    App->>App: SM-2 algorithm updates:<br/>interval, easeFactor, nextReview

    alt Learning card
        Note over App: Again→1min, Good→5min,<br/>Easy→graduate to reviews
    else Review card
        Note over App: Interval multiplied by ease factor<br/>Easy: bonus 1.3x multiplier
    end

    App->>Firestore: Save updated deck (debounced)
    App->>User: Next card (or "Review complete!")
```

## 6. Text Mode (lib.ru)

```mermaid
sequenceDiagram
    actor User
    participant App as React App
    participant Server as Express (Cloud Run)
    participant LibRu as lib.ru
    participant OpenAI as OpenAI API
    participant GCS as Cloud Storage

    User->>App: Paste lib.ru URL
    App->>Server: POST /api/analyze {url}
    Note over Server: Detects lib.ru → text mode

    Server->>LibRu: Fetch page (windows-1251 encoding)
    LibRu-->>Server: HTML with Russian text
    Server->>Server: Extract text, split into ~3500-char chunks

    loop Each chunk
        Server->>OpenAI: TTS API (text → speech)
        Note over Server: trackCost(uid, costs.tts(charCount))
        OpenAI-->>Server: Audio MP3
        Server->>Server: estimateWordTimestamps()<br/>(synthetic timestamps from char offsets)
        Server->>OpenAI: GPT-4o: lemmatizeWords(words)
        Note over Server: trackCost(uid, costs.gpt4o())
    end

    alt Production
        Server->>GCS: Upload audio files
    end

    Server-->>App: SSE: {type: "complete", chunks: [...]}
    Note over App: AudioPlayer.tsx (not VideoPlayer)<br/>Full-width transcript view
```

## 7. Rate Limiting & Cost Control Pipeline

```mermaid
flowchart LR
    Request([Incoming Request])
    Auth[requireAuth<br/>Firebase token verification]
    Rate[Rate Limiter<br/>per-user per-minute]
    Daily[Daily Limit<br/>5/day for analyze]
    Budget[requireBudget<br/>$1/day, $5/week, $10/month]
    TBudget[requireTranslateBudget<br/>$0.50/day, $2.50/week, $5/month]
    Handler[Route Handler]
    Track[trackCost / trackTranslateCost]

    Request --> Auth
    Auth -->|401 if invalid| Rate
    Rate -->|429 if exceeded| Daily
    Daily -->|429 if exceeded| Budget
    Budget -->|429 if exceeded| Handler
    Handler --> Track

    Request --> Auth
    Auth -->|401 if invalid| Rate
    Rate -->|429 if exceeded| TBudget
    TBudget -->|429 if exceeded| Handler
```

## Infrastructure

```
┌─────────────────────────────────────────────────────────┐
│                    Cloud Run (us-central1)               │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  Docker Container                                   │ │
│  │  ┌──────────┐  ┌──────────┐  ┌────────┐  ┌──────┐ │ │
│  │  │ Express  │  │ yt-dlp   │  │ ffmpeg │  │ dist/│ │ │
│  │  │ server   │  │          │  │        │  │(React)│ │ │
│  │  └──────────┘  └──────────┘  └────────┘  └──────┘ │ │
│  └─────────────────────────────────────────────────────┘ │
└─────────────┬───────────┬──────────────┬────────────────┘
              │           │              │
    ┌─────────▼──┐  ┌─────▼─────┐  ┌────▼──────┐
    │ Cloud      │  │ Secret    │  │ Firestore │
    │ Storage    │  │ Manager   │  │ (decks)   │
    │ (videos,   │  │ (API keys)│  │           │
    │  sessions) │  │           │  │           │
    └────────────┘  └───────────┘  └───────────┘

External APIs:
  ├── OpenAI (Whisper, GPT-4o, GPT-4o-mini, TTS)
  ├── Google Translate
  ├── ok.ru (video source)
  └── lib.ru (text source)
```
