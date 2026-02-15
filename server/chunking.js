/**
 * Smart chunking algorithm for video transcripts
 * Splits transcripts at natural pauses (~180 seconds per chunk)
 */

const TARGET_CHUNK_DURATION = 180; // 3 minutes
const MIN_GAP_FOR_BREAK = 0.5; // seconds of silence to consider a natural break
const MIN_FINAL_CHUNK_DURATION = 120; // 2 minutes - merge final chunk if shorter

/**
 * Create smart chunks from Whisper transcript segments
 * @param {Object} transcript - Whisper transcript with segments and words
 * @returns {Array<Object>} Array of chunk objects
 */
export function createChunks(transcript) {
  const { segments, words, duration } = transcript;

  if (!segments || segments.length === 0) {
    // No segments, return single chunk
    return [{
      id: 'chunk-0',
      index: 0,
      startTime: 0,
      endTime: duration || 0,
      duration: duration || 0,
      previewText: words?.slice(0, 15).map(w => w.word).join(' ') || '',
      wordCount: words?.length || 0,
    }];
  }

  // For short videos (< 3 minutes), return single chunk
  if (duration < TARGET_CHUNK_DURATION) {
    return [{
      id: 'chunk-0',
      index: 0,
      startTime: 0,
      endTime: duration,
      duration: duration,
      previewText: segments[0]?.text?.slice(0, 100) || '',
      wordCount: words?.length || 0,
    }];
  }

  const chunks = [];
  let currentChunk = {
    startTime: 0,
    segments: [],
    words: [],
  };

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const nextSegment = segments[i + 1];

    currentChunk.segments.push(segment);

    // Add words that fall within this segment
    const segmentWords = words?.filter(
      w => w.start >= segment.start && w.end <= segment.end
    ) || [];
    currentChunk.words.push(...segmentWords);

    const chunkDuration = segment.end - currentChunk.startTime;

    // Check if we should end the chunk here
    if (chunkDuration >= TARGET_CHUNK_DURATION) {
      // Look for a natural break point
      const gap = nextSegment ? nextSegment.start - segment.end : Infinity;

      if (gap >= MIN_GAP_FOR_BREAK || !nextSegment) {
        // Finalize this chunk
        chunks.push(createChunkObject(
          chunks.length,
          currentChunk.startTime,
          segment.end,
          currentChunk.segments,
          currentChunk.words
        ));

        // Start new chunk
        if (nextSegment) {
          currentChunk = {
            startTime: nextSegment.start,
            segments: [],
            words: [],
          };
        }
      }
    }
  }

  // Handle remaining segments
  if (currentChunk.segments.length > 0) {
    const lastSegment = currentChunk.segments[currentChunk.segments.length - 1];
    const remainingDuration = lastSegment.end - currentChunk.startTime;

    // If final chunk is too short, merge with previous chunk
    if (remainingDuration < MIN_FINAL_CHUNK_DURATION && chunks.length > 0) {
      // Merge with previous chunk
      const prevChunk = chunks[chunks.length - 1];
      const mergedChunk = createChunkObject(
        prevChunk.index,
        prevChunk.startTime,
        lastSegment.end,
        [], // We don't track segments in chunk object, just use preview from merged
        [...(prevChunk._words || []), ...currentChunk.words]
      );
      // Update preview to include both parts
      mergedChunk.previewText = prevChunk.previewText;
      mergedChunk.wordCount = prevChunk.wordCount + currentChunk.words.length;
      chunks[chunks.length - 1] = mergedChunk;
    } else {
      chunks.push(createChunkObject(
        chunks.length,
        currentChunk.startTime,
        lastSegment.end,
        currentChunk.segments,
        currentChunk.words
      ));
    }
  }

  return chunks;
}

/**
 * Create a chunk object with preview text
 */
function createChunkObject(index, startTime, endTime, segments, words) {
  const previewText = segments
    .slice(0, 2)
    .map(s => s.text)
    .join(' ')
    .slice(0, 100);

  return {
    id: `chunk-${index}`,
    index,
    startTime,
    endTime,
    duration: endTime - startTime,
    previewText: previewText + (previewText.length >= 100 ? '...' : ''),
    wordCount: words.length,
  };
}

/**
 * Get words and segments for a specific chunk
 * @param {Object} transcript - Full transcript
 * @param {number} startTime - Chunk start time
 * @param {number} endTime - Chunk end time
 * @returns {Object} Transcript subset for this chunk
 */
export function getChunkTranscript(transcript, startTime, endTime) {
  const { words, segments, language } = transcript;

  // Filter words that overlap with the time range (inclusive)
  // A word is included if any part of it falls within the range
  const chunkWords = (words || [])
    .filter(w => w.end > startTime && w.start < endTime)
    .map(w => ({
      ...w,
      start: Math.max(0, w.start - startTime),
      end: w.end - startTime,
    }));

  // Filter segments that overlap with the time range (inclusive)
  const chunkSegments = (segments || [])
    .filter(s => s.end > startTime && s.start < endTime)
    .map(s => ({
      ...s,
      start: Math.max(0, s.start - startTime),
      end: s.end - startTime,
    }));

  return {
    words: chunkWords,
    segments: chunkSegments,
    language: language || 'ru',
    duration: endTime - startTime,
  };
}

const TARGET_TEXT_CHUNK_CHARS = 3500; // Under 4096 TTS limit
const MIN_FINAL_TEXT_CHUNK_CHARS = 500;

/**
 * Split a long text block into sentence-boundary pieces that fit under the TTS limit.
 * Russian sentences end with . ! ? (or » followed by punctuation).
 * @param {string} block - Text block (may be many thousands of chars)
 * @returns {string[]} Array of pieces, each ≤ TARGET_TEXT_CHUNK_CHARS
 */
function splitBlockIntoSentences(block) {
  // Match sentence-ending punctuation followed by whitespace
  const sentenceEnds = /([.!?»…])\s+/g;
  const pieces = [];
  let current = '';
  let lastIndex = 0;

  for (const match of block.matchAll(sentenceEnds)) {
    const sentenceEnd = match.index + match[0].length - (match[0].length - match[1].length);
    const sentence = block.slice(lastIndex, sentenceEnd + 1);
    lastIndex = sentenceEnd + 1;
    // Skip leading whitespace
    const nextNonSpace = block.slice(lastIndex).search(/\S/);
    if (nextNonSpace > 0) lastIndex += nextNonSpace;

    if (current.length + sentence.length > TARGET_TEXT_CHUNK_CHARS && current.length > 0) {
      pieces.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }

  // Remaining text after last sentence boundary
  if (lastIndex < block.length) {
    const remainder = block.slice(lastIndex);
    if (current.length + remainder.length > TARGET_TEXT_CHUNK_CHARS && current.length > 0) {
      pieces.push(current.trim());
      current = remainder;
    } else {
      current += remainder;
    }
  }

  if (current.trim().length > 0) {
    pieces.push(current.trim());
  }

  return pieces;
}

/**
 * Create chunks from a plain text string for TTS processing.
 * Handles lib.ru-style formatting where lines are wrapped at ~72 chars with single newlines.
 * Each chunk stays under ~3500 chars to fit within OpenAI TTS's 4096-char limit.
 * @param {string} text - Full text content
 * @returns {Array<Object>} Array of text chunk objects
 */
export function createTextChunks(text) {
  // Step 1: Split on double-newlines (section breaks)
  const sections = text.split(/\n\s*\n/).filter(s => s.trim().length > 0);

  if (sections.length === 0) {
    return [makeTextChunk(0, text.trim())];
  }

  // Step 2: Unwrap line-wrapped paragraphs within each section.
  // lib.ru wraps at ~72 chars using single newlines within paragraphs.
  // Join single newlines with spaces, preserving double-newline section breaks.
  const normalizedSections = sections.map(s => {
    return s.trim().replace(/([^\n])\n([^\n])/g, '$1 $2').replace(/\s+/g, ' ').trim();
  });

  // Step 3: Break sections into TTS-sized pieces
  const allPieces = [];
  for (const section of normalizedSections) {
    if (section.length <= TARGET_TEXT_CHUNK_CHARS) {
      allPieces.push(section);
    } else {
      // Section too long — split on sentence boundaries
      allPieces.push(...splitBlockIntoSentences(section));
    }
  }

  // Step 4: Accumulate pieces into chunks (merge small pieces together)
  const chunks = [];
  let currentText = '';

  for (const piece of allPieces) {
    // Short pieces (section dividers like "* * *") always merge with neighbors
    const isShort = piece.length < 50;
    const combined = currentText ? currentText + '\n\n' + piece : piece;

    if (!isShort && combined.length > TARGET_TEXT_CHUNK_CHARS && currentText.length > 0) {
      chunks.push(makeTextChunk(chunks.length, currentText));
      currentText = piece;
    } else {
      currentText = combined;
    }
  }

  // Handle remaining text
  if (currentText.length > 0) {
    if (currentText.length < MIN_FINAL_TEXT_CHUNK_CHARS && chunks.length > 0) {
      const prev = chunks[chunks.length - 1];
      chunks[chunks.length - 1] = makeTextChunk(prev.index, prev.text + '\n\n' + currentText);
    } else {
      chunks.push(makeTextChunk(chunks.length, currentText));
    }
  }

  return chunks;
}

function makeTextChunk(index, text) {
  return {
    id: `chunk-${index}`,
    index,
    text,
    previewText: text.slice(0, 100) + (text.length > 100 ? '...' : ''),
    wordCount: text.split(/\s+/).length,
    status: 'pending',
  };
}

/**
 * Format time in MM:SS format
 */
export function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
