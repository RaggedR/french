#!/usr/bin/env node

/**
 * Download OpenRussian dictionary TSVs from the Badestrand/russian-dictionary
 * GitHub repo. Saves to server/data/openrussian/.
 *
 * Usage:
 *   node server/scripts/download-openrussian.js
 *
 * Downloads 4 TSV files (~21MB total):
 *   - nouns.csv        — declension forms for nouns
 *   - verbs.csv        — conjugation forms for verbs
 *   - adjectives.csv   — long/short/comparative forms for adjectives
 *   - others.csv       — adverbs, prepositions, conjunctions, etc.
 *
 * Each file is self-contained with columns: bare, accented, translations_en,
 * plus POS-specific morphological columns.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data', 'openrussian');

const BASE_URL = 'https://raw.githubusercontent.com/Badestrand/russian-dictionary/master';

const FILES = [
  'nouns.csv',
  'verbs.csv',
  'adjectives.csv',
  'others.csv',
];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      // Handle redirects (GitHub raw sometimes 301s)
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        return download(response.headers.location, dest).then(resolve, reject);
      }
      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        return reject(new Error(`HTTP ${response.statusCode} for ${url}`));
      }
      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', (err) => { fs.unlinkSync(dest); reject(err); });
    }).on('error', (err) => { fs.unlinkSync(dest); reject(err); });
  });
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  for (const file of FILES) {
    const url = `${BASE_URL}/${file}`;
    const dest = path.join(DATA_DIR, file);

    if (fs.existsSync(dest)) {
      console.log(`  [skip] ${file} already exists`);
      continue;
    }

    process.stdout.write(`  Downloading ${file}...`);
    await download(url, dest);
    const size = (fs.statSync(dest).size / 1024 / 1024).toFixed(1);
    console.log(` ${size} MB`);
  }

  console.log('Done. TSVs saved to server/data/openrussian/');
}

main().catch(err => {
  console.error('Download failed:', err.message);
  process.exit(1);
});
