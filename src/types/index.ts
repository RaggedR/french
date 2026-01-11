export interface Token {
  text: string;
  isWord: boolean;
  index: number;
}

export interface Translation {
  word: string;
  translation: string;
  sourceLanguage: string;
}

export type TranslatorProvider = 'mymemory' | 'libretranslate' | 'google';

export interface TranslatorConfig {
  provider: TranslatorProvider;
  googleApiKey?: string;
  libreTranslateUrl?: string;
}

export type SupportedLanguage = 'fr' | 'th';
