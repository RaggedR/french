# Feature: Whisper STT on TTS Audio for Text-Mode Timestamps
> Replaces estimated word timestamps with real Whisper-derived timestamps in text mode (lib.ru), producing accurate word-level sync during audio playback.

## Overview

Text mode generates TTS audio from lib.ru text, then needs word-level timestamps so words highlight in sync with playback. Previously, timestamps were estimated by distributing audio duration proportionally across words by character length (`estimateWordTimestamps`). This produced poor sync because TTS speech varies in speed.

The new approach (`transcribeAndAlignTTS`) runs the TTS audio back through OpenAI Whisper to get real word-level timestamps, then uses `alignWhisperToOriginal` (fuzzy two-pointer matching) to map those timestamps back to the original text words. This handles Whisper mishearing TTS output by using edit-distance fuzzy matching.

**Cost impact**: Adds ~$0.006/minute of audio per chunk (Whisper pricing). Tracked via `costs.whisper(duration)`.

## Resources

- [CLAUDE.md](/CLAUDE.md) - Core Flow (Text Mode) section

## Assets

- `server/media.js` - `transcribeAndAlignTTS()` (composition function), `estimateWordTimestamps()` (legacy fallback), `alignWhisperToOriginal()` (alignment engine)
- `server/index.js` - Two call sites: download-chunk text mode (~line 1693) and prefetch text mode (~line 1891)
- `server/scripts/generate-demo.js` - Demo generation uses `transcribeAndAlignTTS` for text chunks
- `server/media.test.js` - Unit tests for `transcribeAndAlignTTS`
- `server/integration.test.js` - Integration tests with `transcribeAndAlignTTS` mock
