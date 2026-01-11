import { useState, useCallback } from 'react';
import type { Translation, TranslatorConfig, SupportedLanguage } from '../types';
import { translate } from '../services/translators';

interface UseTranslationResult {
  translation: Translation | null;
  isLoading: boolean;
  error: string | null;
  translateWord: (word: string, sourceLanguage: SupportedLanguage) => Promise<void>;
  clearTranslation: () => void;
}

export function useTranslation(config: TranslatorConfig): UseTranslationResult {
  const [translation, setTranslation] = useState<Translation | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const translateWord = useCallback(
    async (word: string, sourceLanguage: SupportedLanguage) => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await translate(word, sourceLanguage, config);
        setTranslation(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Translation failed');
        setTranslation(null);
      } finally {
        setIsLoading(false);
      }
    },
    [config]
  );

  const clearTranslation = useCallback(() => {
    setTranslation(null);
    setError(null);
  }, []);

  return {
    translation,
    isLoading,
    error,
    translateWord,
    clearTranslation,
  };
}
