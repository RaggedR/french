import type { Translation, SupportedLanguage } from '../../types';

const DEFAULT_URL = 'https://libretranslate.com/translate';

export async function translateWithLibreTranslate(
  word: string,
  sourceLanguage: SupportedLanguage,
  apiUrl: string = DEFAULT_URL
): Promise<Translation> {
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      q: word,
      source: sourceLanguage,
      target: 'en',
      format: 'text',
    }),
  });

  if (!response.ok) {
    throw new Error('LibreTranslate API request failed');
  }

  const data = await response.json();

  return {
    word,
    translation: data.translatedText,
    sourceLanguage,
  };
}
