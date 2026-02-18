import { useState } from 'react';
import { TERMS_OF_SERVICE, PRIVACY_POLICY } from '../legal';

interface LoginScreenProps {
  onSignIn: () => void;
  error?: string | null;
}

export function LoginScreen({ onSignIn, error }: LoginScreenProps) {
  const [expandedLegal, setExpandedLegal] = useState<'tos' | 'privacy' | null>(null);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-sm w-full bg-white rounded-xl shadow-lg p-8 text-center">
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">
          Russian Video & Text
        </h1>
        <p className="text-gray-600 text-sm mb-8">
          Watch Russian videos and read texts with synced transcripts, click-to-translate, and SRS flashcard review.
        </p>

        <button
          onClick={onSignIn}
          className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-gray-300 rounded-lg bg-white hover:bg-gray-50 transition-colors text-sm font-medium text-gray-700 shadow-sm"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
          Sign in with Google
        </button>

        <p className="mt-4 text-xs text-gray-500" data-testid="legal-agreement">
          By signing in, you agree to our{' '}
          <button
            onClick={() => setExpandedLegal(expandedLegal === 'tos' ? null : 'tos')}
            className="text-blue-600 hover:text-blue-800 underline"
            data-testid="login-tos-link"
          >
            Terms of Service
          </button>
          {' '}and{' '}
          <button
            onClick={() => setExpandedLegal(expandedLegal === 'privacy' ? null : 'privacy')}
            className="text-blue-600 hover:text-blue-800 underline"
            data-testid="login-privacy-link"
          >
            Privacy Policy
          </button>
        </p>

        {expandedLegal === 'tos' && (
          <div className="mt-3 max-h-48 overflow-y-auto text-left text-xs text-gray-500 whitespace-pre-line border rounded-lg p-3" data-testid="login-tos-content">
            {TERMS_OF_SERVICE}
          </div>
        )}
        {expandedLegal === 'privacy' && (
          <div className="mt-3 max-h-48 overflow-y-auto text-left text-xs text-gray-500 whitespace-pre-line border rounded-lg p-3" data-testid="login-privacy-content">
            {PRIVACY_POLICY}
          </div>
        )}

        {error && (
          <p className="mt-4 text-sm text-red-600">{error}</p>
        )}
      </div>
    </div>
  );
}
