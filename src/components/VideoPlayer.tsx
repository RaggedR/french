import { useRef, useEffect, useCallback, useState } from 'react';
import Player from '@vimeo/player';
import Hls from 'hls.js';

declare global {
  interface Window {
    YT: typeof YT;
    onYouTubeIframeAPIReady: () => void;
  }
}

interface VideoPlayerProps {
  url: string;
  originalUrl?: string;
  onTimeUpdate: (currentTime: number) => void;
  seekTo?: number | null;
  onSeekComplete?: () => void;
}

type VideoSource =
  | { type: 'youtube'; id: string }
  | { type: 'vimeo'; id: string }
  | { type: 'direct'; url: string };

function getVideoSource(originalUrl: string | undefined, directUrl: string): VideoSource {
  if (originalUrl) {
    // YouTube
    const ytPatterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    ];
    for (const pattern of ytPatterns) {
      const match = originalUrl.match(pattern);
      if (match) return { type: 'youtube', id: match[1] };
    }

    // Vimeo - handles vimeo.com/123456 and player.vimeo.com/video/123456
    const vimeoPatterns = [
      /vimeo\.com\/(?:video\/)?(\d+)/,
      /player\.vimeo\.com\/video\/(\d+)/,
    ];
    for (const pattern of vimeoPatterns) {
      const match = originalUrl.match(pattern);
      if (match) return { type: 'vimeo', id: match[1] };
    }

    // ok.ru - use direct URL instead of iframe (no JS API for sync)
    // Just fall through to 'direct' type to use HTML5 video player
    if (/ok\.ru/.test(originalUrl)) {
      return { type: 'direct', url: directUrl };
    }
  }

  return { type: 'direct', url: directUrl };
}

export function VideoPlayer({
  url,
  originalUrl,
  onTimeUpdate,
  seekTo,
  onSeekComplete,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const ytPlayerRef = useRef<YT.Player | null>(null);
  const vimeoPlayerRef = useRef<Player | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<number | null>(null);

  const source = getVideoSource(originalUrl, url);

  const [ytReady, setYtReady] = useState(false);

  // Load YouTube API
  useEffect(() => {
    if (source.type !== 'youtube') return;

    if (window.YT && window.YT.Player) {
      setYtReady(true); // eslint-disable-line react-hooks/set-state-in-effect -- checking external API readiness
      return;
    }

    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);

    window.onYouTubeIframeAPIReady = () => {
      setYtReady(true);
    };
  }, [source.type]);

  // Initialize YouTube player
  useEffect(() => {
    if (source.type !== 'youtube' || !ytReady || !containerRef.current) return;

    const playerDiv = document.createElement('div');
    playerDiv.id = 'yt-player';
    containerRef.current.innerHTML = '';
    containerRef.current.appendChild(playerDiv);

    ytPlayerRef.current = new window.YT.Player('yt-player', {
      videoId: source.id,
      playerVars: {
        autoplay: 0,
        controls: 1,
        modestbranding: 1,
        rel: 0,
      },
      events: {
        onReady: () => {
          intervalRef.current = window.setInterval(() => {
            if (ytPlayerRef.current?.getCurrentTime) {
              onTimeUpdate(ytPlayerRef.current.getCurrentTime());
            }
          }, 100);
        },
      },
    });

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      if (ytPlayerRef.current?.destroy) {
        ytPlayerRef.current.destroy();
      }
    };
  }, [source.type, source.type === 'youtube' ? source.id : null, ytReady, onTimeUpdate]);

  // Initialize Vimeo player
  useEffect(() => {
    if (source.type !== 'vimeo' || !containerRef.current) return;

    containerRef.current.innerHTML = '';
    const iframe = document.createElement('iframe');
    iframe.src = `https://player.vimeo.com/video/${source.id}?autoplay=0`;
    iframe.width = '100%';
    iframe.height = '100%';
    iframe.frameBorder = '0';
    iframe.allow = 'autoplay; fullscreen; picture-in-picture';
    iframe.allowFullscreen = true;
    containerRef.current.appendChild(iframe);

    const player = new Player(iframe);
    vimeoPlayerRef.current = player;

    player.on('timeupdate', (data) => {
      onTimeUpdate(data.seconds);
    });

    return () => {
      player.destroy();
      vimeoPlayerRef.current = null;
    };
  }, [source.type, source.type === 'vimeo' ? source.id : null, onTimeUpdate]);

  // Handle seeking for YouTube
  useEffect(() => {
    if (source.type === 'youtube' && seekTo !== null && seekTo !== undefined && ytPlayerRef.current?.seekTo) {
      ytPlayerRef.current.seekTo(seekTo, true);
      onSeekComplete?.();
    }
  }, [source.type, seekTo, onSeekComplete]);

  // Handle seeking for Vimeo
  useEffect(() => {
    if (source.type === 'vimeo' && seekTo !== null && seekTo !== undefined && vimeoPlayerRef.current) {
      vimeoPlayerRef.current.setCurrentTime(seekTo).then(() => {
        onSeekComplete?.();
      });
    }
  }, [source.type, seekTo, onSeekComplete]);

  // Handle time updates for HTML5 video - use polling for smoother sync
  useEffect(() => {
    if (source.type !== 'direct' || !videoRef.current) return;

    // Poll every 100ms for smoother word highlighting
    const interval = window.setInterval(() => {
      if (videoRef.current && !videoRef.current.paused) {
        onTimeUpdate(videoRef.current.currentTime);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [source.type, onTimeUpdate]);

  // Fallback for paused state updates
  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current) {
      onTimeUpdate(videoRef.current.currentTime);
    }
  }, [onTimeUpdate]);

  // Initialize HLS.js for .m3u8 streams
  useEffect(() => {
    if (source.type !== 'direct' || !videoRef.current) return;

    const isHls = source.url.includes('.m3u8');
    if (!isHls) return;

    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(source.url);
      hls.attachMedia(videoRef.current);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        console.error('[HLS] Error:', data);
      });

      return () => {
        hls.destroy();
      };
    } else if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari native HLS support
      videoRef.current.src = source.url;
    }
  }, [source.type, source.type === 'direct' ? source.url : null]);

  // Handle seeking for HTML5 video
  useEffect(() => {
    if (source.type === 'direct' && seekTo !== null && seekTo !== undefined && videoRef.current) {
      videoRef.current.currentTime = seekTo;
      onSeekComplete?.();
    }
  }, [source.type, seekTo, onSeekComplete]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (source.type === 'youtube' && ytPlayerRef.current) {
        const player = ytPlayerRef.current;
        switch (e.code) {
          case 'Space':
            e.preventDefault();
            if (player.getPlayerState?.() === 1) {
              player.pauseVideo?.();
            } else {
              player.playVideo?.();
            }
            break;
          case 'ArrowLeft':
            e.preventDefault();
            player.seekTo?.(Math.max(0, (player.getCurrentTime?.() || 0) - 5), true);
            break;
          case 'ArrowRight':
            e.preventDefault();
            player.seekTo?.((player.getCurrentTime?.() || 0) + 5, true);
            break;
        }
      } else if (source.type === 'vimeo' && vimeoPlayerRef.current) {
        const player = vimeoPlayerRef.current;
        switch (e.code) {
          case 'Space':
            e.preventDefault();
            player.getPaused().then((paused) => {
              if (paused) {
                player.play();
              } else {
                player.pause();
              }
            });
            break;
          case 'ArrowLeft':
            e.preventDefault();
            player.getCurrentTime().then((time) => {
              player.setCurrentTime(Math.max(0, time - 5));
            });
            break;
          case 'ArrowRight':
            e.preventDefault();
            player.getCurrentTime().then((time) => {
              player.setCurrentTime(time + 5);
            });
            break;
        }
      } else if (source.type === 'direct' && videoRef.current) {
        switch (e.code) {
          case 'Space':
            e.preventDefault();
            if (videoRef.current.paused) {
              videoRef.current.play();
            } else {
              videoRef.current.pause();
            }
            break;
          case 'ArrowLeft':
            e.preventDefault();
            videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 5);
            break;
          case 'ArrowRight':
            e.preventDefault();
            videoRef.current.currentTime = Math.min(
              videoRef.current.duration,
              videoRef.current.currentTime + 5
            );
            break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [source.type]);

  const renderPlayer = () => {
    switch (source.type) {
      case 'youtube':
      case 'vimeo':
        return <div ref={containerRef} className="w-full aspect-video" />;
      case 'direct': {
        // For HLS, don't set src - hls.js will handle it
        const isHls = source.url.includes('.m3u8');
        return (
          <video
            ref={videoRef}
            src={isHls ? undefined : source.url}
            onTimeUpdate={handleTimeUpdate}
            controls
            className="w-full aspect-video"
            crossOrigin="anonymous"
          />
        );
      }
    }
  };

  return (
    <div className="relative bg-black rounded-lg overflow-hidden">
      {renderPlayer()}
      <div className="absolute bottom-full left-0 right-0 p-2 text-xs text-gray-500 text-center">
        Space: play/pause | Arrow keys: seek ±5s
      </div>
    </div>
  );
}
