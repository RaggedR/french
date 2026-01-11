import type { Translation, TranslatorConfig, SupportedLanguage } from '../../types';
import { translateWithMyMemory } from './myMemory';
import { translateWithLibreTranslate } from './libreTranslate';
import { translateWithGoogle } from './googleTranslate';

// Cache translations in localStorage
const CACHE_KEY = 'translation_cache';

function getCache(): Record<string, Translation> {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    return cached ? JSON.parse(cached) : {};
  } catch {
    return {};
  }
}

function setCache(cache: Record<string, Translation>): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore storage errors
  }
}

function getCacheKey(word: string, sourceLanguage: SupportedLanguage): string {
  return `${sourceLanguage}:${word.toLowerCase()}`;
}

export async function translate(
  word: string,
  sourceLanguage: SupportedLanguage,
  config: TranslatorConfig
): Promise<Translation> {
  const cacheKey = getCacheKey(word, sourceLanguage);
  const cache = getCache();

  // Check cache first
  if (cache[cacheKey]) {
    return cache[cacheKey];
  }

  let translation: Translation;

  switch (config.provider) {
    case 'mymemory':
      translation = await translateWithMyMemory(word, sourceLanguage);
      break;
    case 'libretranslate':
      translation = await translateWithLibreTranslate(
        word,
        sourceLanguage,
        config.libreTranslateUrl
      );
      break;
    case 'google':
      if (!config.googleApiKey) {
        throw new Error('Google API key is required');
      }
      translation = await translateWithGoogle(word, sourceLanguage, config.googleApiKey);
      break;
    default:
      throw new Error(`Unknown translator provider: ${config.provider}`);
  }

  // Cache the result
  cache[cacheKey] = translation;
  setCache(cache);

  return translation;
}

export function clearTranslationCache(): void {
  localStorage.removeItem(CACHE_KEY);
}
