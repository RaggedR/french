import type { Translation, SupportedLanguage } from '../../types';

const API_URL = 'https://translation.googleapis.com/language/translate/v2';

export async function translateWithGoogle(
  word: string,
  sourceLanguage: SupportedLanguage,
  apiKey: string
): Promise<Translation> {
  if (!apiKey) {
    throw new Error('Google Translate API key is required');
  }

  const response = await fetch(`${API_URL}?key=${apiKey}`, {
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
    const error = await response.json();
    throw new Error(error.error?.message || 'Google Translate API request failed');
  }

  const data = await response.json();

  return {
    word,
    translation: data.data.translations[0].translatedText,
    sourceLanguage,
  };
}
