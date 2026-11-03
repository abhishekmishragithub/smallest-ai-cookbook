export type WordTimestamp = {
  id: number;
  word: string;
  start: number;
  end: number;
};

/** Whitespace split used by the narrate contract. Leading and trailing empties drop. */
export function splitWords(narration: string): string[] {
  return narration.split(/\s+/).filter((word) => word.length > 0);
}

/**
 * Compare spoken tokens without caring about punctuation or case.
 * "Lightning," and "lightning" both become "lightning".
 */
export function normalizeWord(word: string): string {
  return word.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Map a TTS word_timestamp onto an index of narration.split(/\s+/).
 * The frame id is the word index when the normalized words agree.
 * If the id is off but the same word exists nearby, use the closest unused index.
 */
export function indexForTimestamp(
  words: string[],
  frame: WordTimestamp,
  used: Set<number>,
): number | null {
  const heard = normalizeWord(frame.word);
  if (!heard) return null;

  if (
    frame.id >= 0 &&
    frame.id < words.length &&
    !used.has(frame.id) &&
    normalizeWord(words[frame.id]) === heard
  ) {
    return frame.id;
  }

  let best: number | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let index = 0; index < words.length; index += 1) {
    if (used.has(index)) continue;
    if (normalizeWord(words[index]) !== heard) continue;
    const dist = Math.abs(index - frame.id);
    if (dist < bestDist) {
      best = index;
      bestDist = dist;
    }
  }
  return best;
}

/** Seconds from the start of speech until the word at `atWord` begins. */
export function estimateCueTimeSec(words: string[], atWord: number, msPerChar: number): number {
  let chars = 0;
  const last = Math.min(atWord, words.length);
  for (let index = 0; index < last; index += 1) {
    chars += words[index].length + 1;
  }
  return (chars * msPerChar) / 1000;
}

/** Latest word whose estimated start is at or before `elapsedSec`. */
export function wordIndexAtEstimate(words: string[], elapsedSec: number, msPerChar: number): number {
  let wordIndex = -1;
  for (let index = 0; index < words.length; index += 1) {
    if (estimateCueTimeSec(words, index, msPerChar) <= elapsedSec + 1e-9) {
      wordIndex = index;
    } else {
      break;
    }
  }
  return wordIndex;
}

export function syntheticTimestamps(narration: string, msPerChar: number): WordTimestamp[] {
  const words = splitWords(narration);
  let cursor = 0;
  return words.map((word, id) => {
    const duration = Math.max(0.06, ((word.length + 1) * msPerChar) / 1000);
    const frame = {
      id,
      word,
      start: round3(cursor),
      end: round3(cursor + duration),
    };
    cursor += duration;
    return frame;
  });
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
