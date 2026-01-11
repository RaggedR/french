import type { Token, SupportedLanguage } from '../types';

export function detectLanguage(text: string): SupportedLanguage {
  // Thai Unicode range: \u0E00-\u0E7F
  const thaiMatches = (text.match(/[\u0E00-\u0E7F]/g) || []).length;
  const totalChars = text.replace(/\s/g, '').length;

  // If more than 30% Thai characters, consider it Thai
  if (totalChars > 0 && thaiMatches / totalChars > 0.3) {
    return 'th';
  }

  return 'fr';
}

export function tokenizeText(text: string, language: SupportedLanguage): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  if (language === 'th') {
    // Use Intl.Segmenter for Thai word segmentation
    const segmenter = new Intl.Segmenter('th', { granularity: 'word' });
    const segments = segmenter.segment(text);

    for (const segment of segments) {
      tokens.push({
        text: segment.segment,
        isWord: segment.isWordLike || false,
        index: index++,
      });
    }
  } else {
    // For French and other space-separated languages
    // Use Intl.Segmenter for proper word boundaries (handles accents)
    const segmenter = new Intl.Segmenter('fr', { granularity: 'word' });
    const segments = segmenter.segment(text);

    for (const segment of segments) {
      tokens.push({
        text: segment.segment,
        isWord: segment.isWordLike || false,
        index: index++,
      });
    }
  }

  return tokens;
}

export function getWordForTranslation(token: Token): string {
  // Clean the word for translation (lowercase, trim)
  return token.text.toLowerCase().trim();
}
