/**
 * OpenRussian dictionary service.
 *
 * Loads TSV files from server/data/openrussian/ into an in-memory Map
 * keyed by `bare` (dictionary form). Each entry includes stressed form,
 * POS, translations, and morphological tables (declension/conjugation/
 * adjective forms) matching the DictionaryEntry shape used by the frontend.
 *
 * Lookup is by bare form. When the frontend sends a lemma (from GPT-4o
 * lemmatization), we try the lemma first, then fall back to the raw word.
 * No reverse inflected-form index is built (would cost ~100MB RAM).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_DIR = path.join(__dirname, 'data', 'openrussian');

/** @type {Map<string, object>} bare → DictionaryEntry */
let index = new Map();

/**
 * Convert OpenRussian apostrophe-style stress marks to Unicode combining accent.
 * e.g. "челове'к" → "челове́к"
 *
 * The apostrophe appears after the stressed vowel in the source data.
 * We replace (vowel)(') with (vowel)(U+0301 combining acute accent).
 */
export function convertStress(text) {
  if (!text) return text;
  return text.replace(/([аеёиоуыэюяАЕЁИОУЫЭЮЯ])'/g, '$1\u0301');
}

/**
 * Parse a TSV line into a keyed object using the header row.
 * Handles \r\n line endings.
 */
function parseTsvLine(line, headers) {
  const values = line.replace(/\r$/, '').split('\t');
  const obj = {};
  for (let i = 0; i < headers.length; i++) {
    obj[headers[i]] = values[i] || '';
  }
  return obj;
}

/**
 * Parse semicolon/comma-separated translation string into an array.
 * "speak, talk; say, tell" → ["speak", "talk", "say", "tell"]
 */
function parseTranslations(raw) {
  if (!raw) return [];
  return raw.split(/[;,]/).map(t => t.trim()).filter(Boolean);
}

/**
 * Normalize ё→е for index lookup (same as frontend normalizeWord).
 */
function normalizeForLookup(word) {
  return word.toLowerCase().replace(/ё/g, 'е');
}

/**
 * Build a noun entry from a parsed row.
 */
function buildNounEntry(row) {
  return {
    stressedForm: convertStress(row.accented),
    pos: 'noun',
    gender: row.gender || undefined,
    translations: parseTranslations(row.translations_en),
    declension: {
      sg: {
        nom: convertStress(row.sg_nom),
        gen: convertStress(row.sg_gen),
        dat: convertStress(row.sg_dat),
        acc: convertStress(row.sg_acc),
        inst: convertStress(row.sg_inst),
        prep: convertStress(row.sg_prep),
      },
      pl: {
        nom: convertStress(row.pl_nom),
        gen: convertStress(row.pl_gen),
        dat: convertStress(row.pl_dat),
        acc: convertStress(row.pl_acc),
        inst: convertStress(row.pl_inst),
        prep: convertStress(row.pl_prep),
      },
    },
  };
}

/**
 * Build a verb entry from a parsed row.
 */
function buildVerbEntry(row) {
  return {
    stressedForm: convertStress(row.accented),
    pos: 'verb',
    aspect: row.aspect || undefined,
    aspectPair: row.partner ? convertStress(row.partner) : undefined,
    translations: parseTranslations(row.translations_en),
    conjugation: {
      present: {
        sg1: convertStress(row.presfut_sg1),
        sg2: convertStress(row.presfut_sg2),
        sg3: convertStress(row.presfut_sg3),
        pl1: convertStress(row.presfut_pl1),
        pl2: convertStress(row.presfut_pl2),
        pl3: convertStress(row.presfut_pl3),
      },
      past: {
        m: convertStress(row.past_m),
        f: convertStress(row.past_f),
        n: convertStress(row.past_n) || undefined,
        pl: convertStress(row.past_pl),
      },
      imperative: {
        sg: convertStress(row.imperative_sg),
        pl: convertStress(row.imperative_pl),
      },
    },
  };
}

/**
 * Build an adjective entry from a parsed row.
 */
function buildAdjectiveEntry(row) {
  return {
    stressedForm: convertStress(row.accented),
    pos: 'adjective',
    translations: parseTranslations(row.translations_en),
    adjectiveForms: {
      long: {
        m: convertStress(row.decl_m_nom),
        f: convertStress(row.decl_f_nom),
        n: convertStress(row.decl_n_nom),
        pl: convertStress(row.decl_pl_nom),
      },
      short: {
        m: convertStress(row.short_m),
        f: convertStress(row.short_f),
        n: convertStress(row.short_n),
        pl: convertStress(row.short_pl),
      },
      comparative: convertStress(row.comparative) || undefined,
      superlative: convertStress(row.superlative) || undefined,
    },
  };
}

/**
 * Build an entry for "other" words (adverbs, prepositions, etc.).
 */
function buildOtherEntry(row) {
  return {
    stressedForm: convertStress(row.accented),
    pos: 'other',
    translations: parseTranslations(row.translations_en),
  };
}

/**
 * Load a single TSV file and return parsed rows.
 */
function loadTsv(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  const headers = lines[0].replace(/\r$/, '').split('\t');
  return lines.slice(1).map(line => parseTsvLine(line, headers));
}

/**
 * Initialize the dictionary from TSV files.
 * Gracefully no-ops if the data directory doesn't exist.
 *
 * @param {string} [dataDir] — override data directory (for tests)
 */
export async function initDictionary(dataDir = DEFAULT_DATA_DIR) {
  if (!fs.existsSync(dataDir)) {
    console.log('[Dictionary] Data directory not found, skipping initialization');
    return;
  }

  const newIndex = new Map();
  let count = 0;

  // Nouns
  for (const row of loadTsv(path.join(dataDir, 'nouns.csv'))) {
    if (!row.bare) continue;
    newIndex.set(normalizeForLookup(row.bare), buildNounEntry(row));
    count++;
  }

  // Verbs
  for (const row of loadTsv(path.join(dataDir, 'verbs.csv'))) {
    if (!row.bare) continue;
    newIndex.set(normalizeForLookup(row.bare), buildVerbEntry(row));
    count++;
  }

  // Adjectives
  for (const row of loadTsv(path.join(dataDir, 'adjectives.csv'))) {
    if (!row.bare) continue;
    newIndex.set(normalizeForLookup(row.bare), buildAdjectiveEntry(row));
    count++;
  }

  // Others (adverbs, prepositions, conjunctions, etc.)
  for (const row of loadTsv(path.join(dataDir, 'others.csv'))) {
    if (!row.bare) continue;
    newIndex.set(normalizeForLookup(row.bare), buildOtherEntry(row));
    count++;
  }

  index = newIndex;
  console.log(`[Dictionary] Loaded ${count} entries`);
}

/**
 * Look up a word in the dictionary.
 *
 * @param {string} word — the surface form the user clicked
 * @param {string} [lemma] — the lemma from GPT-4o lemmatization (preferred)
 * @returns {object|null} DictionaryEntry or null
 */
export function lookupWord(word, lemma) {
  // Try lemma first (most accurate — GPT-4o identified the dictionary form)
  if (lemma) {
    const entry = index.get(normalizeForLookup(lemma));
    if (entry) return entry;
  }
  // Fall back to the raw word as bare form
  return index.get(normalizeForLookup(word)) || null;
}

/**
 * Reset the index (for test isolation).
 */
export function _resetForTesting() {
  index = new Map();
}
