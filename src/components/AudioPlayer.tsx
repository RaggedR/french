import { useRef, useEffect, useCallback } from 'react';

interface AudioPlayerProps {
  url: string;
  onTimeUpdate: (currentTime: number) => void;
}

export function AudioPlayer({ url, onTimeUpdate }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);

  // Poll every 100ms for smooth word highlighting (same pattern as VideoPlayer)
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (audioRef.current && !audioRef.current.paused) {
        onTimeUpdate(audioRef.current.currentTime);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [onTimeUpdate]);

  // Fallback for paused state updates (seeking while paused)
  const handleTimeUpdate = useCallback(() => {
    if (audioRef.current) {
      onTimeUpdate(audioRef.current.currentTime);
    }
  }, [onTimeUpdate]);

  // Keyboard shortcuts: Space = play/pause, arrows = seek ±5s
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (!audioRef.current) return;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          if (audioRef.current.paused) {
            audioRef.current.play();
          } else {
            audioRef.current.pause();
          }
          break;
        case 'ArrowLeft':
          e.preventDefault();
          audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 5);
          break;
        case 'ArrowRight':
          e.preventDefault();
          audioRef.current.currentTime = Math.min(
            audioRef.current.duration,
            audioRef.current.currentTime + 5
          );
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="w-full">
      <audio
        ref={audioRef}
        src={url}
        onTimeUpdate={handleTimeUpdate}
        controls
        className="w-full"
      />
      <p className="text-xs text-gray-500 text-center mt-1">
        Space: play/pause | Arrow keys: seek ±5s
      </p>
    </div>
  );
}
