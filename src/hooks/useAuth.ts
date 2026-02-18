import { useState, useEffect, useCallback } from 'react';
import { onAuthStateChanged, signInWithRedirect, signOut as firebaseSignOut, GoogleAuthProvider } from 'firebase/auth';
import { auth } from '../firebase';

export interface AuthUser {
  displayName: string | null;
  photoURL: string | null;
  email: string | null;
}

export interface AuthState {
  userId: string | null;
  user: AuthUser | null;
  isLoading: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const googleProvider = new GoogleAuthProvider();

function useAuthReal(): AuthState {
  const [userId, setUserId] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser) {
        setUserId(firebaseUser.uid);
        setUser({
          displayName: firebaseUser.displayName,
          photoURL: firebaseUser.photoURL,
          email: firebaseUser.email,
        });
      } else {
        setUserId(null);
        setUser(null);
      }
      setIsLoading(false);
    });

    return unsubscribe;
  }, []);

  const signInWithGoogle = useCallback(async () => {
    await signInWithRedirect(auth, googleProvider);
  }, []);

  const signOut = useCallback(async () => {
    await firebaseSignOut(auth);
  }, []);

  return { userId, user, isLoading, signInWithGoogle, signOut };
}

// E2E test bypass — return a mock user immediately so Playwright tests
// don't need real Google auth. The env var is set in playwright.config.ts.
// Note: import.meta.env.VITE_E2E_TEST is resolved at build time by Vite,
// so production builds (without the env var) always use useAuthReal.
//
// Tests can set window.__E2E_NO_AUTH = true (via addInitScript) to start
// in a logged-out state, showing the login screen.
function useAuthE2E(): AuthState {
  const startLoggedOut = typeof window !== 'undefined' && (window as any).__E2E_NO_AUTH;
  const [loggedIn, setLoggedIn] = useState(!startLoggedOut);

  return {
    userId: loggedIn ? 'e2e-test-user' : null,
    user: loggedIn ? { displayName: 'Test User', photoURL: null, email: 'test@example.com' } : null,
    isLoading: false,
    signInWithGoogle: useCallback(async () => { setLoggedIn(true); }, []),
    signOut: useCallback(async () => { setLoggedIn(false); }, []),
  };
}

export const useAuth = import.meta.env.VITE_E2E_TEST ? useAuthE2E : useAuthReal;
