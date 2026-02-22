import { useState, useEffect, useCallback } from 'react';
import type { TranslatorConfig, SRSCard } from '../types';
import { getUsage } from '../services/api';
import type { UsageData, SubscriptionData } from '../services/api';
import { TERMS_OF_SERVICE, PRIVACY_POLICY } from '../legal';

interface SettingsPanelProps {
  config: TranslatorConfig;
  onConfigChange: (config: TranslatorConfig) => void;
  isOpen: boolean;
  onClose: () => void;
  cards: SRSCard[];
  userId: string | null;
  onDeleteAccount: () => Promise<void>;
  subscription: SubscriptionData | null;
  onManageSubscription: () => Promise<void>;
  onSubscribe: () => Promise<void>;
}

function UsageBar({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
  const color = pct > 80 ? 'bg-red-500' : pct > 50 ? 'bg-yellow-500' : 'bg-green-500';
  return (
    <div className="mb-2">
      <div className="flex justify-between text-xs text-gray-600 mb-0.5">
        <span>{label}</span>
        <span>${used.toFixed(2)} / ${limit.toFixed(2)}</span>
      </div>
      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function SettingsPanel({
  config,
  onConfigChange,
  isOpen,
  onClose,
  cards,
  userId,
  onDeleteAccount,
  subscription,
  onManageSubscription,
  onSubscribe,
}: SettingsPanelProps) {
  const [expandedLegal, setExpandedLegal] = useState<'tos' | 'privacy' | null>(null);
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Fetch usage when panel opens
  useEffect(() => {
    if (isOpen && userId) {
      setUsageLoading(true);
      getUsage()
        .then(setUsage)
        .catch(() => setUsage(null))
        .finally(() => setUsageLoading(false));
    }
  }, [isOpen, userId]);

  // Reset delete state when panel closes
  useEffect(() => {
    if (!isOpen) {
      setDeleteConfirm('');
      setDeleteError(null);
    }
  }, [isOpen]);

  const handleExportDeck = useCallback(() => {
    const json = JSON.stringify(cards, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const date = new Date().toISOString().slice(0, 10);
    const a = document.createElement('a');
    a.href = url;
    a.download = `russian-deck-${date}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [cards]);

  const handleDeleteAccount = useCallback(async () => {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await onDeleteAccount();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete account');
    } finally {
      setIsDeleting(false);
    }
  }, [onDeleteAccount]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-80 bg-white shadow-lg z-50 p-6 overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold">Settings</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Word Frequency Underlining */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Word Frequency Underlining
          </label>
          <p className="text-xs text-gray-500 mb-3">
            Underline words by frequency rank (from Anna Karenina). Rank 1 = most common (и, он, она), rank 1000 = intermediate, rank 2000+ = rare. Leave empty to disable.
          </p>
          <div className="flex gap-2 items-center">
            <input
              type="number"
              min={1}
              max={12252}
              value={config.freqRangeMin ?? ''}
              onChange={(e) => onConfigChange({
                ...config,
                freqRangeMin: e.target.value ? parseInt(e.target.value, 10) : undefined,
              })}
              placeholder="From"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
            <span className="text-gray-400 text-sm">–</span>
            <input
              type="number"
              min={1}
              max={12252}
              value={config.freqRangeMax ?? ''}
              onChange={(e) => onConfigChange({
                ...config,
                freqRangeMax: e.target.value ? parseInt(e.target.value, 10) : undefined,
              })}
              placeholder="To"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
          </div>
          <p className="text-xs text-gray-400 mt-1">
            e.g., 1000–2000 (based on Anna Karenina word frequencies)
          </p>
        </div>

        {/* Deck Export */}
        <div className="mb-6 border-t pt-6">
          <h3 className="text-sm font-medium text-gray-700 mb-2">Deck</h3>
          <button
            onClick={handleExportDeck}
            disabled={cards.length === 0}
            data-testid="export-deck-btn"
            className="w-full px-4 py-2 text-sm font-medium rounded-md border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {cards.length === 0 ? 'No cards to export' : `Export ${cards.length} cards`}
          </button>
        </div>

        {/* Subscription */}
        {userId && subscription && (
          <div className="mb-6 border-t pt-6" data-testid="subscription-section">
            <h3 className="text-sm font-medium text-gray-700 mb-2">Subscription</h3>
            {subscription.status === 'trialing' && !subscription.needsPayment && (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                    Free trial
                  </span>
                  <span className="text-xs text-gray-500" data-testid="trial-days-remaining">
                    {subscription.trialDaysRemaining} days remaining
                  </span>
                </div>
                <button
                  onClick={onSubscribe}
                  className="w-full px-4 py-2 text-sm font-medium rounded-md border border-gray-300 bg-white hover:bg-gray-50 transition-colors"
                >
                  Subscribe now — {subscription.priceDisplay}
                </button>
              </>
            )}
            {subscription.status === 'active' && (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                    Active
                  </span>
                  {subscription.currentPeriodEnd && (
                    <span className="text-xs text-gray-500">
                      Next billing: {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <button
                  onClick={onManageSubscription}
                  data-testid="manage-subscription-btn"
                  className="w-full px-4 py-2 text-sm font-medium rounded-md border border-gray-300 bg-white hover:bg-gray-50 transition-colors"
                >
                  Manage subscription
                </button>
              </>
            )}
            {subscription.status === 'past_due' && (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">
                    Payment issue
                  </span>
                  <span className="text-xs text-gray-500">Retrying payment</span>
                </div>
                <button
                  onClick={onManageSubscription}
                  className="w-full px-4 py-2 text-sm font-medium rounded-md border border-yellow-300 bg-yellow-50 hover:bg-yellow-100 transition-colors text-yellow-800"
                >
                  Update payment method
                </button>
              </>
            )}
            {subscription.status === 'canceled' && (
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                  Canceled
                </span>
              </div>
            )}
          </div>
        )}

        {/* Usage */}
        {userId && (
          <div className="mb-6 border-t pt-6">
            <h3 className="text-sm font-medium text-gray-700 mb-3">API Usage</h3>
            <p className="text-xs text-gray-500 mb-2">OpenAI + Google Translate (merged into single budget)</p>
            {usageLoading ? (
              <p className="text-xs text-gray-400">Loading...</p>
            ) : usage ? (
              <div>
                <UsageBar label="Today" used={usage.daily.used} limit={usage.daily.limit} />
                <UsageBar label="This week" used={usage.weekly.used} limit={usage.weekly.limit} />
                <UsageBar label="This month" used={usage.monthly.used} limit={usage.monthly.limit} />
              </div>
            ) : (
              <p className="text-xs text-gray-400">Could not load usage data</p>
            )}
          </div>
        )}

        {/* Info */}
        <div className="border-t pt-6">
          <h3 className="text-sm font-medium text-gray-700 mb-2">About</h3>
          <p className="text-xs text-gray-500">
            This app transcribes Russian videos using OpenAI Whisper and provides
            click-to-translate functionality using Google Translate.
          </p>
          <p className="text-xs text-gray-500 mt-2">
            Translations are cached on the server to reduce API calls.
          </p>
          <p className="text-xs text-gray-500 mt-2">
            OpenAI API key is configured on the server.
          </p>
        </div>

        {/* Legal */}
        <div className="border-t pt-6 mt-6">
          <button
            onClick={() => setExpandedLegal(expandedLegal === 'tos' ? null : 'tos')}
            className="w-full text-left text-sm font-medium text-gray-700 hover:text-gray-900 flex justify-between items-center"
            data-testid="tos-toggle"
          >
            Terms of Service
            <span className="text-gray-400">{expandedLegal === 'tos' ? '−' : '+'}</span>
          </button>
          {expandedLegal === 'tos' && (
            <div className="mt-2 max-h-64 overflow-y-auto text-xs text-gray-500 whitespace-pre-line" data-testid="tos-content">
              {TERMS_OF_SERVICE}
            </div>
          )}

          <button
            onClick={() => setExpandedLegal(expandedLegal === 'privacy' ? null : 'privacy')}
            className="w-full text-left text-sm font-medium text-gray-700 hover:text-gray-900 flex justify-between items-center mt-4"
            data-testid="privacy-toggle"
          >
            Privacy Policy
            <span className="text-gray-400">{expandedLegal === 'privacy' ? '−' : '+'}</span>
          </button>
          {expandedLegal === 'privacy' && (
            <div className="mt-2 max-h-64 overflow-y-auto text-xs text-gray-500 whitespace-pre-line" data-testid="privacy-content">
              {PRIVACY_POLICY}
            </div>
          )}
        </div>

        {/* Delete Account */}
        {userId && (
          <div className="border-t pt-6 mt-6 mb-8">
            <h3 className="text-sm font-medium text-red-600 mb-2">Danger Zone</h3>
            <p className="text-xs text-gray-500 mb-3">
              Permanently delete your account, flashcard deck, and all session data. This cannot be undone.
            </p>
            {deleteError && (
              <p className="text-xs text-red-600 mb-2">{deleteError}</p>
            )}
            <input
              type="text"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder='Type "DELETE" to confirm'
              data-testid="delete-confirm-input"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-red-500"
            />
            <button
              onClick={handleDeleteAccount}
              disabled={deleteConfirm !== 'DELETE' || isDeleting}
              data-testid="delete-account-btn"
              className="w-full px-4 py-2 text-sm font-medium rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isDeleting ? 'Deleting...' : 'Delete My Account'}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
