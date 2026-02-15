/**
 * Regression test: run the TypeScript compiler to catch type errors.
 *
 * Added after a bug where a `cleanup` variable was referenced outside
 * its closure scope in App.tsx, causing TS2304/TS2349 build failures
 * that weren't caught until the frontend stopped loading.
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

describe('Frontend TypeScript', () => {
  it('passes type checking (tsc -b)', () => {
    const result = execSync('npx tsc -b 2>&1', {
      cwd: projectRoot,
      encoding: 'utf8',
      timeout: 30000,
    });
    expect(result.trim()).toBe('');
  });
});

describe('TranscriptPanel word click behavior', () => {
  const source = readFileSync(
    resolve(projectRoot, 'src/components/TranscriptPanel.tsx'),
    'utf8'
  );

  it('does NOT seek the video when a word is clicked', () => {
    // Word click should only show a translation popup.
    // It must NOT call onWordClick or any seek function.
    // This regression has been re-introduced twice — never again.
    expect(source).not.toMatch(/onWordClick\s*\(/);
  });

  it('does not accept an onWordClick prop', () => {
    expect(source).not.toMatch(/onWordClick\s*[?:]?\s*\(/);
    expect(source).not.toMatch(/onWordClick.*WordTimestamp/);
  });
});
