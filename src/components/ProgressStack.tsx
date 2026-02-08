import { ProgressBar } from './ProgressBar';
import type { ProgressState } from '../types';

interface ProgressStackProps {
  progress: ProgressState[];
}

export function ProgressStack({ progress }: ProgressStackProps) {
  // Filter to show relevant progress bars
  // During analysis: show audio and transcription
  // During chunk download: show only video
  const audioProgress = progress.find(p => p.type === 'audio');
  const transcriptionProgress = progress.find(p => p.type === 'transcription');
  const videoProgress = progress.find(p => p.type === 'video');

  // If we have video progress, we're in chunk download phase
  if (videoProgress) {
    return (
      <div className="space-y-4 w-full max-w-md mx-auto">
        <ProgressBar
          label="Downloading Video"
          progress={videoProgress.progress}
          status={videoProgress.status}
          message={videoProgress.message}
        />
      </div>
    );
  }

  // Analysis phase: show audio and transcription
  return (
    <div className="space-y-4 w-full max-w-md mx-auto">
      {audioProgress && (
        <ProgressBar
          label="Downloading Audio"
          progress={audioProgress.progress}
          status={audioProgress.status}
          message={audioProgress.message}
        />
      )}
      {transcriptionProgress && (
        <ProgressBar
          label="Transcribing"
          progress={transcriptionProgress.progress}
          status={transcriptionProgress.status}
          message={transcriptionProgress.message}
        />
      )}
    </div>
  );
}
