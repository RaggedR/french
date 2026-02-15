interface DeckBadgeProps {
  dueCount: number;
  totalCount: number;
  onClick: () => void;
}

export function DeckBadge({ dueCount, totalCount, onClick }: DeckBadgeProps) {
  return (
    <button
      onClick={onClick}
      className="relative p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md"
      title={totalCount === 0 ? 'Flashcard deck (empty)' : `${dueCount} cards due for review`}
    >
      {/* Cards/deck icon */}
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
      </svg>
      {dueCount > 0 && (
        <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-xs font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
          {dueCount > 99 ? '99+' : dueCount}
        </span>
      )}
    </button>
  );
}
