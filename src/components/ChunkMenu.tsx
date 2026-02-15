import type { VideoChunk, ContentType } from '../types';

interface ChunkMenuProps {
  title: string;
  totalDuration: number;
  chunks: VideoChunk[];
  hasMoreChunks: boolean;
  isLoadingMore: boolean;
  contentType?: ContentType;
  onSelectChunk: (chunk: VideoChunk) => void;
  onLoadMore: () => void;
  onReset: () => void;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins === 0) {
    return `${secs}s`;
  }
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

export function ChunkMenu({
  title,
  totalDuration,
  chunks,
  hasMoreChunks,
  isLoadingMore,
  contentType = 'video',
  onSelectChunk,
  onLoadMore,
  onReset,
}: ChunkMenuProps) {
  const isText = contentType === 'text';

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-6 pb-4 border-b">
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
            <p className="text-sm text-gray-500 mt-1">
              {isText
                ? `${chunks.length} sections`
                : `Total duration: ${formatTime(totalDuration)} \u00B7 ${chunks.length} parts`
              }
            </p>
          </div>
          <button
            onClick={onReset}
            className="text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 px-3 py-1 rounded"
          >
            {isText ? 'Different text' : 'Different video'}
          </button>
        </div>
      </div>

      {/* Instructions */}
      <div className="mb-6 p-4 bg-blue-50 rounded-lg">
        <p className="text-sm text-blue-800">
          {isText
            ? 'Select a section to listen to. TTS audio will be generated with synchronized word highlighting.'
            : 'Select a part to download and study. Each part is approximately 3 minutes long with synchronized transcript.'
          }
        </p>
      </div>

      {/* Chunk grid */}
      <div className="grid gap-4 sm:grid-cols-2">
        {chunks.map((chunk) => {
          const isReady = chunk.status === 'ready';
          const isDownloading = chunk.status === 'downloading';

          return (
            <button
              key={chunk.id}
              onClick={() => onSelectChunk(chunk)}
              disabled={isDownloading}
              className={`text-left p-4 rounded-lg border-2 transition-all hover:shadow-md ${
                isReady
                  ? 'border-green-200 bg-green-50 hover:border-green-300'
                  : isDownloading
                  ? 'border-yellow-200 bg-yellow-50 cursor-wait'
                  : 'border-gray-200 bg-white hover:border-blue-300'
              }`}
            >
              <div className="flex justify-between items-start mb-2">
                <span className="font-medium text-gray-900">
                  {isText ? `Section ${chunk.index + 1}` : `Part ${chunk.index + 1}`}
                </span>
                <span className="text-xs text-gray-500">
                  {isText ? `${chunk.wordCount} words` : formatDuration(chunk.duration)}
                </span>
              </div>

              {!isText && (
                <div className="text-xs text-gray-500 mb-2">
                  {formatTime(chunk.startTime)} - {formatTime(chunk.endTime)}
                </div>
              )}

              <p className="text-sm text-gray-600 line-clamp-2">
                {chunk.previewText || 'No preview available'}
              </p>

              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs text-gray-400">
                  {isText ? '' : `${chunk.wordCount} words`}
                </span>
                {isReady && (
                  <span className="text-xs text-green-600 flex items-center gap-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Ready
                  </span>
                )}
                {isDownloading && (
                  <span className="text-xs text-yellow-600 flex items-center gap-1">
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    {isText ? 'Generating' : 'Downloading'}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Load More button */}
      {hasMoreChunks && (
        <div className="mt-6 text-center">
          <button
            onClick={onLoadMore}
            disabled={isLoadingMore}
            className={`px-6 py-3 rounded-lg font-medium transition-all ${
              isLoadingMore
                ? 'bg-gray-100 text-gray-400 cursor-wait'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {isLoadingMore ? (
              <span className="flex items-center gap-2">
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Loading more parts...
              </span>
            ) : (
              'Load More Parts'
            )}
          </button>
          <p className="text-xs text-gray-500 mt-2">
            More parts of the video are available
          </p>
        </div>
      )}
    </div>
  );
}
