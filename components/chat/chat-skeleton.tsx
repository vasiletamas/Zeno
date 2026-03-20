'use client'

export function ChatSkeleton() {
  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
      {/* Skeleton bubble 1 - agent, 60% width */}
      <div className="flex justify-start">
        <div
          className="bg-linen rounded-2xl rounded-bl-sm h-12 animate-[skeleton-pulse_1.5s_ease-in-out_infinite]"
          style={{ width: '60%' }}
        />
      </div>

      {/* Skeleton bubble 2 - agent, 75% width */}
      <div className="flex justify-start">
        <div
          className="bg-linen rounded-2xl rounded-bl-sm h-16 animate-[skeleton-pulse_1.5s_ease-in-out_infinite]"
          style={{ width: '75%', animationDelay: '200ms' }}
        />
      </div>

      {/* Skeleton bubble 3 - agent, 45% width */}
      <div className="flex justify-start">
        <div
          className="bg-linen rounded-2xl rounded-bl-sm h-10 animate-[skeleton-pulse_1.5s_ease-in-out_infinite]"
          style={{ width: '45%', animationDelay: '400ms' }}
        />
      </div>
    </div>
  )
}
