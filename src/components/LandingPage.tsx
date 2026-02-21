import { useState } from 'react';
import { TERMS_OF_SERVICE, PRIVACY_POLICY } from '../legal';

interface LandingPageProps {
  onSignIn: () => void;
  error?: string | null;
  isSigningIn?: boolean;
}

function GoogleIcon() {
  return (
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
  );
}

export function LandingPage({ onSignIn, error, isSigningIn }: LandingPageProps) {
  const [expandedLegal, setExpandedLegal] = useState<'tos' | 'privacy' | null>(null);

  return (
    <div className="min-h-screen bg-gray-50">
      <main>
      {/* Hero */}
      <section className="px-4 pt-16 pb-12 text-center max-w-3xl mx-auto">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">
          Russian Video & Text
        </h1>
        <p className="text-lg text-gray-600 mb-8 max-w-xl mx-auto">
          Watch Russian videos and read texts with synced transcripts, click-to-translate, and spaced repetition flashcards.
        </p>
        {isSigningIn ? (
          <div className="flex flex-col items-center gap-4" data-testid="signing-in-indicator">
            <div className="inline-block animate-spin rounded-full h-10 w-10 border-4 border-blue-500 border-t-transparent"></div>
            <p className="text-gray-600 text-base">Loading... Please wait</p>
          </div>
        ) : (
          <button
            data-testid="get-started-btn"
            onClick={onSignIn}
            aria-label="Get Started with Google Sign-In"
            className="inline-flex items-center gap-3 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-base font-medium shadow-sm"
          >
            <GoogleIcon />
            Get Started
          </button>
        )}
        {error && (
          <p className="mt-4 text-sm text-red-600">{error}</p>
        )}
      </section>

      {/* Features */}
      <section className="px-4 py-12 bg-white">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-semibold text-gray-900 text-center mb-8">Features</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="flex gap-4">
              <div className="shrink-0 w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h3 className="font-medium text-gray-900">Synced Transcripts</h3>
                <p className="text-sm text-gray-600 mt-1">Word-by-word highlighting synced to video playback from ok.ru.</p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="shrink-0 w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              </div>
              <div>
                <h3 className="font-medium text-gray-900">Text Reading with TTS</h3>
                <p className="text-sm text-gray-600 mt-1">AI-generated audio for lib.ru texts with synced word highlighting.</p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="shrink-0 w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
                </svg>
              </div>
              <div>
                <h3 className="font-medium text-gray-900">Click-to-Translate</h3>
                <p className="text-sm text-gray-600 mt-1">Instant word translation and sentence extraction with one click.</p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="shrink-0 w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
              </div>
              <div>
                <h3 className="font-medium text-gray-900">SRS Flashcards</h3>
                <p className="text-sm text-gray-600 mt-1">Spaced repetition deck with keyboard shortcuts to lock in vocabulary.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="px-4 py-12">
        <div className="max-w-md mx-auto text-center">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">Pricing</h2>
          <div className="bg-white rounded-xl shadow-lg p-8">
            <p className="text-4xl font-bold text-gray-900">$5<span className="text-lg font-normal text-gray-500">/month</span></p>
            <p className="text-gray-600 mt-2">30-day free trial — no card required</p>
            <button
              data-testid="get-started-btn-pricing"
              onClick={onSignIn}
              className="mt-6 w-full inline-flex items-center justify-center gap-3 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-base font-medium shadow-sm"
            >
              <GoogleIcon />
              Get Started
            </button>
          </div>
        </div>
      </section>
      </main>

      {/* Footer with legal */}
      <footer className="px-4 py-8 border-t bg-white">
        <div className="max-w-2xl mx-auto text-center">
          <p className="text-xs text-gray-500" data-testid="legal-agreement">
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
        </div>
      </footer>
    </div>
  );
}
