interface PaywallScreenProps {
  status: 'trialing' | 'active' | 'past_due' | 'canceled';
  price: number;
  onSubscribe: () => Promise<void>;
  onSignOut: () => Promise<void>;
}

export function PaywallScreen({ status, price, onSubscribe, onSignOut }: PaywallScreenProps) {
  const isCanceled = status === 'canceled';

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-sm w-full bg-white rounded-xl shadow-lg p-8 text-center">
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">
          {isCanceled ? 'Subscription Canceled' : 'Free Trial Ended'}
        </h1>
        <p className="text-gray-600 text-sm mb-6">
          {isCanceled
            ? 'Your subscription has been canceled. Subscribe again to continue using Russian Video & Text.'
            : 'Your 30-day free trial has ended. Subscribe to continue watching Russian videos and reading texts with synced transcripts and flashcard review.'}
        </p>

        <div className="bg-gray-50 rounded-lg p-4 mb-6">
          <p className="text-3xl font-bold text-gray-900">${price}</p>
          <p className="text-sm text-gray-500">per month</p>
        </div>

        <button
          onClick={onSubscribe}
          data-testid="subscribe-btn"
          className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors shadow-sm"
        >
          Subscribe
        </button>

        <button
          onClick={onSignOut}
          className="mt-4 text-sm text-gray-500 hover:text-gray-700 underline"
          data-testid="paywall-sign-out"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
