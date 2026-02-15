import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import type { SRSCard, SRSRating } from '../types';
import { createCard, sm2, getDueCards as getDueCardsFromAll, normalizeCardId } from '../utils/sm2';

const DECK_KEY = 'srs_deck';
const DEBOUNCE_MS = 500;

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

export function useDeck(userId: string | null) {
  const [cards, setCards] = useState<SRSCard[]>([]);
  const [loaded, setLoaded] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  // Track whether we've done the initial Firestore load for this userId
  const loadedUserRef = useRef<string | null>(null);

  // Persist cards to Firestore (debounced)
  const saveToFirestore = useCallback((nextCards: SRSCard[]) => {
    if (!userId) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const deckRef = doc(db, 'decks', userId);
      setDoc(deckRef, { cards: nextCards, updatedAt: serverTimestamp() }).catch(() => {
        // Silent fail — data is still in React state, will retry on next mutation
      });
    }, DEBOUNCE_MS);
  }, [userId]);

  // Load from Firestore when userId becomes available
  useEffect(() => {
    if (!userId || loadedUserRef.current === userId) return;

    let cancelled = false;

    async function load() {
      const deckRef = doc(db, 'decks', userId!);
      try {
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

  const addCard = useCallback((word: string, translation: string, sourceLanguage: string, context?: string, contextTranslation?: string) => {
    setCards(prev => {
      const id = normalizeCardId(word);
      if (prev.some(c => c.id === id)) return prev; // duplicate
      const next = [...prev, createCard(word, translation, sourceLanguage, context, contextTranslation)];
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

  return { cards, dueCards, dueCount, addCard, removeCard, reviewCard, isWordInDeck, loaded };
}
