import type { Translation, SupportedLanguage } from '../../types';

const API_URL = 'https://api.mymemory.translated.net/get';

export async function translateWithMyMemory(
  word: string,
  sourceLanguage: SupportedLanguage
): Promise<Translation> {
  const langPair = `${sourceLanguage}|en`;
  const url = `${API_URL}?q=${encodeURIComponent(word)}&langpair=${langPair}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`MyMemory API request failed: ${response.status}`);
  }

  const data = await response.json();

  if (!data.responseData?.translatedText) {
    throw new Error(data.responseDetails || 'No translation found');
  }

  return {
    word,
    translation: data.responseData.translatedText,
    sourceLanguage,
  };
}
