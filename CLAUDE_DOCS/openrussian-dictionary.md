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

## Backwards Compatibility

- `dictionary` is optional on `SRSCard` and `Translation` — old cards work fine
- `initDictionary()` gracefully no-ops if CSVs are missing (dev without download, CI)
- `lookupWord()` returns `null` when no match — translate still works with just Google Translate
