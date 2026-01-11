# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Language Reader - a web app for reading French or Thai text with click-to-translate functionality. Users upload documents and click any word to see its English translation.

## Commands

```bash
npm run dev      # Start development server
npm run build    # TypeScript check + production build
npm run lint     # Run ESLint
npm run preview  # Preview production build
```

## Architecture

### Core Flow
```
File Upload → File Parser → Tokenizer → Interactive Display → Translation API → Popup
```

### Services (`src/services/`)

- **`fileParser.ts`**: Parses uploaded files. PDF uses pdfjs-dist, EPUB uses JSZip, TXT/HTML parsed directly. PDFs limited to 50 pages for performance.

- **`tokenizer.ts`**: Word segmentation using `Intl.Segmenter` API. Auto-detects language based on Thai Unicode character ratio. Both French and Thai use Intl.Segmenter for proper handling of accented characters and Thai's space-less text.

- **`translators/`**: Pluggable translation backends with localStorage caching:
  - `myMemory.ts` - Free, no API key (default)
  - `libreTranslate.ts` - Free, open source
  - `googleTranslate.ts` - Requires API key
  - `index.ts` - Abstraction layer, handles caching

### Components (`src/components/`)

- **`FileUpload.tsx`**: Drag-and-drop file upload
- **`TextDisplay.tsx`**: Renders tokenized text as clickable word spans
- **`WordPopup.tsx`**: Translation tooltip positioned at click location
- **`SettingsPanel.tsx`**: Translation provider configuration

### State Management

- `App.tsx` manages main state and persists translator config to localStorage
- `useTranslation` hook handles translation API calls and loading states

## Important: Static Assets in `/public/`

- **`pdf.worker.min.mjs`** - PDF.js worker (copied from node_modules/pdfjs-dist)
- **`cmaps/`** - Character maps for non-Latin PDF text extraction (Thai, CJK, etc.)

If pdf.js is updated, these files may need to be re-copied from node_modules.

## Tech Stack

- React 19 + TypeScript + Vite 7
- Tailwind CSS v4 (via @tailwindcss/vite plugin)
- pdfjs-dist (PDF), JSZip (EPUB)
- Google Fonts: Noto Sans Thai for Thai text rendering

## Known Limitations

- PDF parsing limited to 50 pages for performance
- MyMemory API is slow (~1-2s per translation) but results are cached
- Some PDFs with unusual font encodings may not extract Thai text correctly

## Future Features (Not Yet Implemented)

- Phrase selection for multi-word translation
- Word database with familiarity levels
- Color-coded words (unknown/learning/known)
- Spaced repetition flashcards
