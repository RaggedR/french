import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ── Firebase auth mock ─────────────────────────────────────────
let authStateCallback: ((user: unknown) => void) | null = null;
const mockOnAuthStateChanged = vi.fn((_, callback) => {
  authStateCallback = callback;
  return vi.fn(); // unsubscribe
});
const mockSignInWithPopup = vi.fn();
const mockSignOut = vi.fn();

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (...args: unknown[]) => mockOnAuthStateChanged(...args),
  signInWithPopup: (...args: unknown[]) => mockSignInWithPopup(...args),
  signOut: (...args: unknown[]) => mockSignOut(...args),
  GoogleAuthProvider: class MockGoogleProvider {},
}));

vi.mock('../src/firebase', () => ({
  auth: { currentUser: null },
}));

// useAuth chooses between useAuthReal and useAuthE2E at module level
// based on import.meta.env.VITE_E2E_TEST. In vitest, VITE_E2E_TEST is
// undefined, so it uses useAuthReal — which is what we want to test.
import { useAuth } from '../src/hooks/useAuth';

describe('useAuth (real mode)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authStateCallback = null;
  });

  it('starts with isLoading=true and no user', () => {
    const { result } = renderHook(() => useAuth());
    expect(result.current.isLoading).toBe(true);
    expect(result.current.userId).toBeNull();
    expect(result.current.user).toBeNull();
  });

  it('subscribes to onAuthStateChanged on mount', () => {
    renderHook(() => useAuth());
    expect(mockOnAuthStateChanged).toHaveBeenCalledTimes(1);
  });

  it('sets userId and user when auth state resolves with a user', () => {
    const { result } = renderHook(() => useAuth());

    act(() => {
      authStateCallback!({
        uid: 'firebase-uid-123',
        displayName: 'Robin',
        photoURL: 'https://example.com/photo.jpg',
        email: 'robin@example.com',
      });
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.userId).toBe('firebase-uid-123');
    expect(result.current.user).toEqual({
      displayName: 'Robin',
      photoURL: 'https://example.com/photo.jpg',
      email: 'robin@example.com',
    });
  });

  it('clears userId and user when auth state resolves with null', () => {
    const { result } = renderHook(() => useAuth());

    // First sign in
    act(() => {
      authStateCallback!({
        uid: 'uid-1',
        displayName: 'User',
        photoURL: null,
        email: 'user@test.com',
      });
    });
    expect(result.current.userId).toBe('uid-1');

    // Then sign out
    act(() => {
      authStateCallback!(null);
    });

    expect(result.current.userId).toBeNull();
    expect(result.current.user).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('signInWithGoogle calls signInWithPopup', async () => {
    mockSignInWithPopup.mockResolvedValue({});
    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.signInWithGoogle();
    });

    expect(mockSignInWithPopup).toHaveBeenCalledTimes(1);
  });

  it('signOut calls firebaseSignOut', async () => {
    mockSignOut.mockResolvedValue(undefined);
    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.signOut();
    });

    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes from auth on unmount', () => {
    const unsubscribe = vi.fn();
    mockOnAuthStateChanged.mockReturnValue(unsubscribe);

    const { unmount } = renderHook(() => useAuth());
    unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
