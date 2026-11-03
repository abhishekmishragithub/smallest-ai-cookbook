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

export type TimestampMatch = {
  /** First narration word covered by this frame. */
  index: number;
  /** How many narration words this frame covers. A merged token can span two. */
  span: number;
};

/**
 * Map a TTS word_timestamp onto narration words.
 * Prefer the next unused words in order. A frame may cover several words when
 * the server glues them together. Frame ids are only a hint: they restart on
 * some chunk boundaries, so they are not the word index by themselves.
 * Marks every covered index as used.
 */
export function matchTimestamp(
  words: string[],
  frame: WordTimestamp,
  used: Set<number>,
): TimestampMatch | null {
  const heard = normalizeWord(frame.word);
  if (!heard) return null;

  const next = firstUnused(words.length, used);
  if (next !== null) {
    const span = spanFrom(words, next, heard, used);
    if (span > 0) {
      for (let offset = 0; offset < span; offset += 1) used.add(next + offset);
      return { index: next, span };
    }
  }

  if (
    frame.id >= 0 &&
    frame.id < words.length &&
    !used.has(frame.id) &&
    normalizeWord(words[frame.id]) === heard
  ) {
    used.add(frame.id);
    return { index: frame.id, span: 1 };
  }

  for (let index = 0; index < words.length; index += 1) {
    if (used.has(index)) continue;
    if (normalizeWord(words[index]) !== heard) continue;
    used.add(index);
    return { index, span: 1 };
  }
  return null;
}

export function indexForTimestamp(
  words: string[],
  frame: WordTimestamp,
  used: Set<number>,
): number | null {
  return matchTimestamp(words, frame, used)?.index ?? null;
}

function firstUnused(length: number, used: Set<number>): number | null {
  for (let index = 0; index < length; index += 1) {
    if (!used.has(index)) return index;
  }
  return null;
}

function spanFrom(words: string[], start: number, heard: string, used: Set<number>): number {
  let combined = "";
  const limit = Math.min(words.length, start + 6);
  for (let end = start; end < limit; end += 1) {
    if (end !== start && used.has(end)) return 0;
    combined += normalizeWord(words[end]);
    if (combined === heard) return end - start + 1;
    if (!heard.startsWith(combined)) return 0;
  }
  return 0;
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
