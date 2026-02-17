import type { SRSCard } from '../../src/types';

export const TEST_SESSION_ID = 'test-session-001';

export const MOCK_TRANSCRIPT_WORDS = [
  { word: 'Привет,', start: 0.0, end: 0.4, lemma: 'привет' },
  { word: 'как', start: 0.5, end: 0.7, lemma: 'как' },
  { word: 'дела?', start: 0.8, end: 1.2, lemma: 'дело' },
  { word: 'Я', start: 1.5, end: 1.6, lemma: 'я' },
  { word: 'хочу', start: 1.7, end: 2.0, lemma: 'хотеть' },
  { word: 'рассказать', start: 2.1, end: 2.8, lemma: 'рассказать' },
  { word: 'вам', start: 2.9, end: 3.1, lemma: 'вы' },
  { word: 'историю.', start: 3.2, end: 3.8, lemma: 'история' },
  { word: 'Это', start: 4.0, end: 4.2, lemma: 'это' },
  { word: 'было', start: 4.3, end: 4.6, lemma: 'быть' },
  { word: 'давно,', start: 4.7, end: 5.2, lemma: 'давно' },
  { word: 'когда', start: 5.3, end: 5.6, lemma: 'когда' },
  { word: 'я', start: 5.7, end: 5.8, lemma: 'я' },
  { word: 'жил', start: 5.9, end: 6.2, lemma: 'жить' },
  { word: 'в', start: 6.3, end: 6.35, lemma: 'в' },
  { word: 'маленьком', start: 6.4, end: 6.9, lemma: 'маленький' },
  { word: 'городе.', start: 7.0, end: 7.5, lemma: 'город' },
  { word: 'Каждый', start: 8.0, end: 8.3, lemma: 'каждый' },
  { word: 'день', start: 8.4, end: 8.6, lemma: 'день' },
  { word: 'я', start: 8.7, end: 8.8, lemma: 'я' },
  { word: 'ходил', start: 8.9, end: 9.3, lemma: 'ходить' },
  { word: 'в', start: 9.4, end: 9.45, lemma: 'в' },
  { word: 'школу.', start: 9.5, end: 10.0, lemma: 'школа' },
  { word: 'Мне', start: 10.5, end: 10.7, lemma: 'я' },
  { word: 'нравилось', start: 10.8, end: 11.4, lemma: 'нравиться' },
  { word: 'учиться.', start: 11.5, end: 12.0, lemma: 'учиться' },
  { word: 'Книги', start: 12.5, end: 12.8, lemma: 'книга' },
  { word: 'были', start: 12.9, end: 13.1, lemma: 'быть' },
  { word: 'моими', start: 13.2, end: 13.5, lemma: 'мой' },
  { word: 'лучшими', start: 13.6, end: 14.0, lemma: 'лучший' },
  { word: 'друзьями.', start: 14.1, end: 14.8, lemma: 'друг' },
];

export const MOCK_TRANSCRIPT = {
  words: MOCK_TRANSCRIPT_WORDS,
  segments: [
    { text: 'Привет, как дела? Я хочу рассказать вам историю.', start: 0, end: 3.8 },
    { text: 'Это было давно, когда я жил в маленьком городе.', start: 4.0, end: 7.5 },
    { text: 'Каждый день я ходил в школу. Мне нравилось учиться.', start: 8.0, end: 12.0 },
    { text: 'Книги были моими лучшими друзьями.', start: 12.5, end: 14.8 },
  ],
  language: 'ru',
  duration: 15.0,
};

export const MOCK_CHUNKS = [
  {
    id: 'chunk-0',
    index: 0,
    startTime: 0,
    endTime: 90,
    duration: 90,
    previewText: 'Привет, как дела? Я хочу рассказать вам историю...',
    wordCount: 150,
    status: 'pending' as const,
    videoUrl: null,
  },
  {
    id: 'chunk-1',
    index: 1,
    startTime: 90,
    endTime: 180,
    duration: 90,
    previewText: 'Каждый день я ходил в школу...',
    wordCount: 130,
    status: 'pending' as const,
    videoUrl: null,
  },
];

export const MOCK_SINGLE_CHUNK = [
  {
    id: 'chunk-0',
    index: 0,
    startTime: 0,
    endTime: 90,
    duration: 90,
    previewText: 'Привет, как дела? Я хочу рассказать вам историю...',
    wordCount: 150,
    status: 'pending' as const,
    videoUrl: null,
  },
];

export const MOCK_TRANSLATION = {
  word: 'Привет,',
  translation: 'Hello',
  sourceLanguage: 'ru',
};

export const MOCK_SENTENCE = {
  sentence: 'Привет, как дела?',
  translation: 'Hello, how are you?',
};

export function makeDueCard(overrides: Partial<SRSCard> = {}): SRSCard {
  return {
    id: 'привет',
    word: 'привет',
    translation: 'hello',
    sourceLanguage: 'ru',
    context: 'Привет, как дела?',
    contextTranslation: 'Hello, how are you?',
    easeFactor: 2.5,
    interval: 0,
    repetition: 0,
    nextReviewDate: new Date(Date.now() - 86400000).toISOString(),
    addedAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    lastReviewedAt: null,
    ...overrides,
  };
}

export function makeReviewCard(overrides: Partial<SRSCard> = {}): SRSCard {
  return {
    id: 'книга',
    word: 'книга',
    translation: 'book',
    sourceLanguage: 'ru',
    context: 'Книги были моими лучшими друзьями.',
    contextTranslation: 'Books were my best friends.',
    easeFactor: 2.5,
    interval: 1,
    repetition: 1,
    nextReviewDate: new Date(Date.now() - 3600000).toISOString(),
    addedAt: new Date(Date.now() - 86400000 * 5).toISOString(),
    lastReviewedAt: new Date(Date.now() - 86400000).toISOString(),
    ...overrides,
  };
}
