import { useMemo, useCallback, useState } from 'react';
import type { Token, TranslatorConfig } from '../types';
import { tokenizeText, detectLanguage, getWordForTranslation } from '../services/tokenizer';
import { useTranslation } from '../hooks/useTranslation';
import { WordPopup } from './WordPopup';

interface TextDisplayProps {
  text: string;
  config: TranslatorConfig;
}

export function TextDisplay({ text, config }: TextDisplayProps) {
  const [popupPosition, setPopupPosition] = useState<{ x: number; y: number } | null>(null);
  const { translation, isLoading, error, translateWord, clearTranslation } = useTranslation(config);

  const language = useMemo(() => detectLanguage(text), [text]);
  const tokens = useMemo(() => tokenizeText(text, language), [text, language]);

  const handleWordClick = useCallback(
    (e: React.MouseEvent, token: Token) => {
      if (!token.isWord) return;

      const word = getWordForTranslation(token);
      setPopupPosition({ x: e.clientX, y: e.clientY });
      translateWord(word, language);
    },
    [translateWord, language]
  );

  const handleClosePopup = useCallback(() => {
    setPopupPosition(null);
    clearTranslation();
  }, [clearTranslation]);

  return (
    <div className="relative">
      {/* Language indicator */}
      <div className="mb-4 text-sm text-gray-500">
        Detected language: {language === 'th' ? 'Thai' : 'French'}
      </div>

      {/* Text content */}
      <div className="leading-relaxed text-lg">
        {tokens.map((token) => (
          <span
            key={token.index}
            onClick={(e) => handleWordClick(e, token)}
            className={
              token.isWord
                ? 'cursor-pointer hover:bg-yellow-100 hover:text-yellow-900 rounded px-0.5 transition-colors'
                : ''
            }
          >
            {token.text}
          </span>
        ))}
      </div>

      <WordPopup
        translation={translation}
        isLoading={isLoading}
        error={error}
        position={popupPosition}
        onClose={handleClosePopup}
      />
    </div>
  );
}
