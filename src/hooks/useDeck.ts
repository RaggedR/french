import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import * as Sentry from '@sentry/react';
import type { SRSCard, SRSRating, DictionaryEntry } from '../types';
import { createCard, sm2, getDueCards as getDueCardsFromAll, normalizeCardId } from '../utils/sm2';

const DECK_KEY = 'srs_deck';
const DEBOUNCE_MS = 500;

async function getFirestoreHelpers() {
  const [firestoreModule, { db }] = await Promise.all([
    import('firebase/firestore'),
    import('../firebase-db'),
  ]);
  return {
    doc: firestoreModule.doc,
    getDoc: firestoreModule.getDoc,
    setDoc: firestoreModule.setDoc,
    serverTimestamp: firestoreModule.serverTimestamp,
    db,
  };
}

function loadLocalDeck(): SRSCard[] {
  try {
    const saved = localStorage.getItem(DECK_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch {
    // Ignore corrupt data
  }
  return [];
}

function saveLocalBackup(cards: SRSCard[]) {
  try {
    localStorage.setItem(DECK_KEY, JSON.stringify(cards));
  } catch (err) {
    Sentry.captureException(err, { tags: { operation: 'deck_local_backup' } });
  }
}

export function useDeck(userId: string | null) {
  const [cards, setCards] = useState<SRSCard[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  // Track whether we've done the initial Firestore load for this userId
  const loadedUserRef = useRef<string | null>(null);

  const clearSaveError = useCallback(() => setSaveError(null), []);

  // Persist cards to Firestore (debounced)
  const saveToFirestore = useCallback((nextCards: SRSCard[]) => {
    if (!userId) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const { doc, setDoc, serverTimestamp, db } = await getFirestoreHelpers();
        const deckRef = doc(db, 'decks', userId);
        await setDoc(deckRef, { cards: nextCards, updatedAt: serverTimestamp() });
        setSaveError(null);
      } catch (err) {
        console.error('[useDeck] Firestore save failed:', err);
        Sentry.captureException(err, { tags: { operation: 'deck_save' } });
        setSaveError('Deck changes may not be saved — check your connection');
        // Fallback: persist to localStorage so data survives a refresh
        saveLocalBackup(nextCards);
      }
    }, DEBOUNCE_MS);
  }, [userId]);

  // Load from Firestore when userId becomes available
  useEffect(() => {
    if (!userId || loadedUserRef.current === userId) return;

    let cancelled = false;

    async function load() {
      try {
        const { doc, getDoc, setDoc, serverTimestamp, db } = await getFirestoreHelpers();
        const deckRef = doc(db, 'decks', userId!);
        const snap = await getDoc(deckRef);
        if (cancelled) return;

        if (snap.exists() && snap.data().cards?.length > 0) {
          // Firestore has data — use it
          setCards(snap.data().cards);
        } else {
          // Firestore empty — check localStorage for migration
          const local = loadLocalDeck();
          if (local.length > 0) {
            setCards(local);
            // Migrate to Firestore, then clear localStorage
            await setDoc(deckRef, { cards: local, updatedAt: serverTimestamp() });
            localStorage.removeItem(DECK_KEY);
          }
        }
      } catch {
        // Firestore unavailable — fall back to localStorage
        if (!cancelled) {
          setCards(loadLocalDeck());
        }
      }
      if (!cancelled) {
        loadedUserRef.current = userId;
        setLoaded(true);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [userId]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const dueCards = useMemo(() => getDueCardsFromAll(cards), [cards]);
  const dueCount = dueCards.length;

  const addCard = useCallback((word: string, translation: string, sourceLanguage: string, context?: string, contextTranslation?: string, dictionary?: DictionaryEntry) => {
    setCards(prev => {
      const id = normalizeCardId(word);
      if (prev.some(c => c.id === id)) return prev; // duplicate
      const next = [...prev, createCard(word, translation, sourceLanguage, context, contextTranslation, dictionary)];
      saveToFirestore(next);
      return next;
    });
  }, [saveToFirestore]);

  const removeCard = useCallback((id: string) => {
    setCards(prev => {
      const next = prev.filter(c => c.id !== id);
      saveToFirestore(next);
      return next;
    });
  }, [saveToFirestore]);

  const reviewCard = useCallback((id: string, rating: SRSRating) => {
    setCards(prev => {
      const next = prev.map(c => c.id === id ? sm2(c, rating) : c);
      saveToFirestore(next);
      return next;
    });
  }, [saveToFirestore]);

  const isWordInDeck = useCallback((word: string): boolean => {
    const id = normalizeCardId(word);
    return cards.some(c => c.id === id);
  }, [cards]);

  return { cards, dueCards, dueCount, addCard, removeCard, reviewCard, isWordInDeck, loaded, saveError, clearSaveError };
}
