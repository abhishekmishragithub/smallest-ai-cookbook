import { describe, expect, it } from "vitest";
import { createCueScheduler } from "@/lib/cue-scheduler";
import type { Cue } from "@/lib/schemas";
import {
  estimateCueTimeSec,
  indexForTimestamp,
  normalizeWord,
  splitWords,
  syntheticTimestamps,
} from "@/lib/words";

const narration = "Say Lightning, then REST.";
const words = splitWords(narration);
const cues: Cue[] = [
  { id: "say", atWord: 0, kind: "diagram", label: "Say" },
  { id: "lightning", atWord: 1, kind: "highlight", label: "Lightning" },
  { id: "rest", atWord: 3, kind: "arrow", label: "REST" },
];

describe("word matching", () => {
  it("normalizes punctuation and case", () => {
    expect(normalizeWord("Lightning,")).toBe("lightning");
    expect(normalizeWord("wss://api.smallest.ai/waves/v1/tts/live")).toBe("wssapismallestaiwavesv1ttslive");
  });

  it("trusts the frame id when the normalized word matches", () => {
    const index = indexForTimestamp(words, { id: 1, word: "Lightning,", start: 0.4, end: 0.8 }, new Set());
    expect(index).toBe(1);
  });

  it("finds the nearest word when the id is off", () => {
    const index = indexForTimestamp(words, { id: 0, word: "REST.", start: 1, end: 1.4 }, new Set());
    expect(index).toBe(3);
  });

  it("returns null when the word is not in the narration", () => {
    expect(indexForTimestamp(words, { id: 1, word: "nope", start: 0, end: 0.1 }, new Set())).toBeNull();
  });
});

describe("CueScheduler", () => {
  it("draws timestamp cues at the word start, in order", () => {
    const scheduler = createCueScheduler({ narration, cues, msPerChar: 100 });
    scheduler.pushTimestamp({ id: 0, word: "Say", start: 0, end: 0.3 });
    scheduler.pushTimestamp({ id: 1, word: "Lightning,", start: 0.4, end: 0.9 });
    scheduler.pushTimestamp({ id: 3, word: "REST.", start: 1.1, end: 1.5 });

    expect(scheduler.advance(0).cues.map((item) => item.cue.id)).toEqual(["say"]);
    expect(scheduler.advance(0.39).cues).toEqual([]);
    const mid = scheduler.advance(0.4);
    expect(mid.cues.map((item) => [item.cue.id, item.atSec, item.strategy])).toEqual([
      ["lightning", 0.4, "word-timestamps"],
    ]);
    expect(scheduler.advance(1.1).cues.map((item) => item.cue.id)).toEqual(["rest"]);
    expect(scheduler.strategy).toBe("word-timestamps");
  });

  it("estimates timing from character count when no timestamps arrive", () => {
    const msPerChar = 100;
    expect(estimateCueTimeSec(words, 0, msPerChar)).toBe(0);
    expect(estimateCueTimeSec(words, 1, msPerChar)).toBeCloseTo(0.4);
    const scheduler = createCueScheduler({ narration, cues, msPerChar, graceSec: 0.5 });
    expect(scheduler.advance(0.2).cues).toEqual([]);
    expect(scheduler.strategy).toBe("pending");
    const first = scheduler.advance(0.5);
    expect(first.strategy).toBe("character-estimate");
    expect(first.cues.map((item) => item.cue.id)).toEqual(["say", "lightning"]);
    const rest = scheduler.advance(estimateCueTimeSec(words, 3, msPerChar));
    expect(rest.cues.map((item) => item.cue.id)).toEqual(["rest"]);
  });

  it("fires every remaining cue in order when speech ends without timestamps", () => {
    const scheduler = createCueScheduler({ narration, cues, msPerChar: 50, graceSec: 5 });
    const done = scheduler.complete(0.1);
    expect(done.cues.map((item) => item.cue.id)).toEqual(["say", "lightning", "rest"]);
    expect(done.strategy).toBe("character-estimate");
  });

  it("does not repeat a cue if a late timestamp follows the estimate", () => {
    const scheduler = createCueScheduler({ narration, cues, msPerChar: 10, graceSec: 0.2 });
    const early = scheduler.advance(0.2);
    expect(early.cues.map((item) => item.cue.id)).toContain("say");
    scheduler.pushTimestamp({ id: 0, word: "Say", start: 0, end: 0.2 });
    const again = scheduler.advance(1);
    expect(again.cues.map((item) => item.cue.id)).not.toContain("say");
  });

  it("builds synthetic timestamps whose ids match whitespace words", () => {
    const frames = syntheticTimestamps("One two.", 20);
    expect(frames.map((frame) => frame.id)).toEqual([0, 1]);
    expect(frames[0]?.start).toBe(0);
    expect(frames[1]!.start).toBeGreaterThan(0);
  });
});
