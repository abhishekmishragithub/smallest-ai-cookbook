import type { Cue } from "./schemas";
import {
  estimateCueTimeSec,
  indexForTimestamp,
  splitWords,
  wordIndexAtEstimate,
  type WordTimestamp,
} from "./words";

export type SchedulerStrategy = "word-timestamps" | "character-estimate";

export type ScheduledCue = {
  cue: Cue;
  atSec: number;
  strategy: SchedulerStrategy;
  wordIndex: number;
};

export type SchedulerTick = {
  cues: ScheduledCue[];
  wordIndex: number;
  strategy: "pending" | SchedulerStrategy;
};

type Queued = {
  cue: Cue;
  atSec: number;
  wordIndex: number;
};

const DEFAULT_GRACE_SEC = 0.8;
const DEFAULT_MS_PER_CHAR = 22;

export function createCueScheduler(input: {
  narration: string;
  cues: Cue[];
  msPerChar?: number;
  graceSec?: number;
}) {
  const words = splitWords(input.narration);
  const cues = [...input.cues].sort((a, b) => a.atWord - b.atWord || a.id.localeCompare(b.id));
  const msPerChar = input.msPerChar ?? DEFAULT_MS_PER_CHAR;
  const graceSec = input.graceSec ?? DEFAULT_GRACE_SEC;
  const fired = new Set<string>();
  const usedWords = new Set<number>();
  const queued: Queued[] = [];
  const accepted: { index: number; start: number }[] = [];
  let sawTimestamp = false;
  let strategy: "pending" | SchedulerStrategy = "pending";

  function takeEstimate(elapsedSec: number): ScheduledCue[] {
    const out: ScheduledCue[] = [];
    for (const cue of cues) {
      if (fired.has(cue.id)) continue;
      const atSec = estimateCueTimeSec(words, cue.atWord, msPerChar);
      if (atSec > elapsedSec + 1e-9) continue;
      fired.add(cue.id);
      out.push({ cue, atSec, strategy: "character-estimate", wordIndex: cue.atWord });
    }
    return out;
  }

  function releaseQueued(elapsedSec: number): ScheduledCue[] {
    const out: ScheduledCue[] = [];
    for (const item of queued) {
      if (fired.has(item.cue.id)) continue;
      if (item.atSec > elapsedSec + 1e-9) continue;
      fired.add(item.cue.id);
      out.push({
        cue: item.cue,
        atSec: item.atSec,
        strategy: "word-timestamps",
        wordIndex: item.wordIndex,
      });
    }
    return out;
  }

  return {
    get strategy() {
      return strategy;
    },
    pushTimestamp(frame: WordTimestamp): void {
      sawTimestamp = true;
      if (strategy !== "character-estimate") strategy = "word-timestamps";
      const index = indexForTimestamp(words, frame, usedWords);
      if (index === null) return;
      usedWords.add(index);
      accepted.push({ index, start: frame.start });
      for (const cue of cues) {
        if (cue.atWord !== index) continue;
        queued.push({ cue, atSec: frame.start, wordIndex: index });
      }
    },
    advance(elapsedSec: number): SchedulerTick {
      if (strategy === "pending" && !sawTimestamp && elapsedSec >= graceSec) {
        strategy = "character-estimate";
      }

      const cuesDue =
        strategy === "character-estimate" ? takeEstimate(elapsedSec) : releaseQueued(elapsedSec);

      let wordIndex = -1;
      if (strategy === "character-estimate") {
        wordIndex = wordIndexAtEstimate(words, elapsedSec, msPerChar);
      } else if (sawTimestamp) {
        for (const frame of accepted) {
          if (frame.start <= elapsedSec + 1e-9) wordIndex = Math.max(wordIndex, frame.index);
        }
      }

      return { cues: cuesDue, wordIndex, strategy };
    },
    complete(elapsedSec: number): SchedulerTick {
      if (!sawTimestamp) {
        strategy = "character-estimate";
        return this.advance(Math.max(elapsedSec, Number.POSITIVE_INFINITY));
      }
      return this.advance(elapsedSec);
    },
  };
}

export type CueScheduler = ReturnType<typeof createCueScheduler>;
