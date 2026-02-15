import { useState, useEffect } from 'react';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { auth } from '../firebase';

export function useAuth(): { userId: string | null; isLoading: boolean } {
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setUserId(user.uid);
        setIsLoading(false);
      } else {
        // No user — sign in anonymously
        signInAnonymously(auth).catch(() => {
          setIsLoading(false);
        });
      }
    });

    return unsubscribe;
  }, []);

  return { userId, isLoading };
}
