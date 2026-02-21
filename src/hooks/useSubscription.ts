import { useState, useEffect, useCallback } from 'react';
import { getSubscription, createCheckoutSession, createPortalSession } from '../services/api';
import type { SubscriptionData } from '../services/api';

export interface SubscriptionState {
  subscription: SubscriptionData | null;
  isLoading: boolean;
  needsPayment: boolean;
  handleSubscribe: () => Promise<void>;
  handleManageSubscription: () => Promise<void>;
  refetch: () => Promise<void>;
}

function useSubscriptionReal(userId: string | null): SubscriptionState {
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchSubscription = useCallback(async () => {
    if (!userId) {
      setSubscription(null);
      setIsLoading(false);
      return;
    }
    try {
      const data = await getSubscription();
      setSubscription(data);
    } catch (err) {
      console.error('[Subscription] Failed to fetch:', err);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchSubscription();
  }, [fetchSubscription]);

  const handleSubscribe = useCallback(async () => {
    try {
      const { url } = await createCheckoutSession();
      window.location.href = url;
    } catch (err) {
      console.error('[Subscription] Checkout error:', err);
    }
  }, []);

  const handleManageSubscription = useCallback(async () => {
    try {
      const { url } = await createPortalSession();
      window.location.href = url;
    } catch (err) {
      console.error('[Subscription] Portal error:', err);
    }
  }, []);

  return {
    subscription,
    isLoading,
    needsPayment: subscription?.needsPayment ?? false,
    handleSubscribe,
    handleManageSubscription,
    refetch: fetchSubscription,
  };
}

/**
 * E2E test bypass — returns active subscription by default.
 * Tests can override via window.__E2E_SUBSCRIPTION to test paywall flow.
 */
const E2E_DEFAULT_SUBSCRIPTION: SubscriptionData = {
  status: 'active' as const,
  trialEnd: null,
  trialDaysRemaining: 0,
  currentPeriodEnd: '2099-12-31T00:00:00.000Z',
  stripeCustomerId: 'cus_e2e_test',
  stripeSubscriptionId: 'sub_e2e_test',
  needsPayment: false,
  price: 5,
  priceDisplay: '$5/month',
};

function useSubscriptionE2E(userId: string | null): SubscriptionState {
  const override = typeof window !== 'undefined' && (window as any).__E2E_SUBSCRIPTION;
  const subscription: SubscriptionData = override || E2E_DEFAULT_SUBSCRIPTION;

  return {
    subscription: userId ? subscription : null,
    isLoading: false,
    needsPayment: subscription.needsPayment,
    handleSubscribe: useCallback(async () => {
      // In E2E tests, set a flag and "redirect"
      (window as any).__E2E_CHECKOUT_REDIRECTED = true;
    }, []),
    handleManageSubscription: useCallback(async () => {
      (window as any).__E2E_PORTAL_REDIRECTED = true;
    }, []),
    refetch: useCallback(async () => {}, []),
  };
}

export const useSubscription = import.meta.env.VITE_E2E_TEST ? useSubscriptionE2E : useSubscriptionReal;
