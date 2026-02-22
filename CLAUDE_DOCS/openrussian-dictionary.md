# Feature: OpenRussian Dictionary Integration
> Rich flashcard data (stress marks, POS, grammar tables) from the OpenRussian.org dictionary database.

## Overview

When a user clicks a Russian word, the `/api/translate` endpoint now returns a `dictionary` field alongside the Google Translate result. This data comes from an in-memory index built from OpenRussian TSV files (~21MB, 4 files: nouns, verbs, adjectives, others). The dictionary entry includes stressed forms (Unicode combining accent), part of speech, translations, and full morphological tables (noun declension, verb conjugation, adjective forms).

The dictionary data is stored in each `SRSCard` so flashcard review shows grammar tables without needing the dictionary loaded.

## Data Flow

1. **Download**: `server/scripts/download-openrussian.js` fetches TSVs from GitHub to `server/data/openrussian/`
2. **Load**: `server/dictionary.js` `initDictionary()` parses TSVs into a `Map<bare, DictionaryEntry>` at startup
3. **Lookup**: `/api/translate` calls `lookupWord(word, lemma)` — tries lemma first (from GPT-4o), then raw word
4. **Store**: Frontend stores `dictionary` in `SRSCard` via `addCard()` → `createCard()` → Firestore
5. **Render**: `ReviewPanel` passes `card.dictionary` to `RichCardBack` for grammar tables

## Resources

- [RichCardBack component](../src/components/RichCardBack.tsx) — renders grammar tables, stress marks, POS badges
- [Dictionary types](../src/types/index.ts) — `DictionaryEntry`, `NounDeclension`, `VerbConjugation`, `AdjectiveForms`

## Assets

| File | Purpose |
|------|---------|
| `server/scripts/download-openrussian.js` | Downloads 4 TSVs from GitHub |
| `server/dictionary.js` | In-memory dictionary service (`initDictionary`, `lookupWord`, `convertStress`) |
| `server/dictionary.test.js` | Unit tests with fixture TSVs |
| `server/test-fixtures/openrussian/` | Small fixture TSVs for testing |
| `server/data/openrussian/` | Full dataset (gitignored, downloaded at build time) |
| `server/Dockerfile` | Runs download script at build time |
| `src/types/index.ts` | `DictionaryEntry` type + `SRSCard.dictionary` field |
| `src/components/RichCardBack.tsx` | Grammar table rendering component |

## Batch Enrichment (Retroactive Migration)

Cards created before dictionary integration lack `card.dictionary`. The `useDeck` hook automatically enriches them:

1. After loading cards from Firestore, filters for cards missing `dictionary`
2. Calls `POST /api/enrich-deck` with `{ words: [{ word }] }` (auth only, no subscription/budget — free in-memory lookup)
3. Merges returned `DictionaryEntry` objects into cards, saves back to Firestore
4. One-time per card — once enriched & persisted, the API is never called again for that card
5. Best-effort — enrichment failure is silently caught, cards still render with their existing data

## Example Sentence Generation (GPT-4o-mini)

OpenRussian TSVs don't include example sentences, so `RichCardBack`'s "Example" section would always be empty. A second enrichment pass uses GPT-4o-mini to fill this gap:

1. After dictionary enrichment completes, `useDeck` filters for cards with `dictionary` but no `dictionary.example`
2. Calls `POST /api/generate-examples` with `{ words: [string] }` (max 50, auth + subscription + budget — costs $0.002 per call)
3. GPT-4o-mini generates A2-B1 level example sentences with English translations (JSON mode, temperature 0.7)
4. Merges `{ russian, english }` into `card.dictionary.example`, saves back to Firestore
5. One-time per card — once `dictionary.example` is populated & persisted, it's never regenerated
6. Best-effort — failure is silently caught, cards still render without examples

The two enrichment passes chain sequentially: dictionary (free, in-memory) → examples (paid, GPT). This ensures example generation only targets cards that actually have dictionary data to attach to.

## Backwards Compatibility

- `dictionary` is optional on `SRSCard` and `Translation` — old cards work fine
- `dictionary.example` is optional — cards without examples still render normally
- `initDictionary()` gracefully no-ops if CSVs are missing (dev without download, CI)
- `lookupWord()` returns `null` when no match — translate still works with just Google Translate
