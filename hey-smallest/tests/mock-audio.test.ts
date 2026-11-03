import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { QUESTIONS, unknownAnswer } from "@/lib/catalog";
import { createCueScheduler } from "@/lib/cue-scheduler";
import { matchTimestamp, splitWords, type WordTimestamp } from "@/lib/words";

type Recording = {
  id: string;
  narration: string;
  wordCount: number;
  durationSec: number;
  word_timestamps: WordTimestamp[];
};

const audioDir = path.join(process.cwd(), "public/mock-audio");

function loadRecording(id: string): Recording {
  return JSON.parse(readFileSync(path.join(audioDir, `${id}.timestamps.json`), "utf8")) as Recording;
}

function align(narration: string, frames: WordTimestamp[]) {
  const words = splitWords(narration);
  const used = new Set<number>();
  const matches = frames.map((frame) => {
    const match = matchTimestamp(words, frame, used);
    return { frame, match };
  });
  return { words, matches };
}

describe("bundled mock recordings", () => {
  it("aligns call-flow even when frame ids restart at 0", () => {
    const recording = loadRecording("call-flow");
    const { words, matches } = align(recording.narration, recording.word_timestamps);
    const fetchFrame = matches.find((item) => item.frame.word === "fetch" && item.frame.id === 0);
    expect(fetchFrame?.match?.index).toBe(words.findIndex((word) => word === "fetch"));
    expect(fetchFrame?.match?.index).toBeGreaterThan(0);
    expect(matches.every((item) => item.match)).toBe(true);
    const indexes = matches.map((item) => item.match?.index ?? -1);
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
  });

  it("treats the merged phone path as one frame covering two narration words", () => {
    const recording = loadRecording("phone");
    expect(recording.word_timestamps).toHaveLength(42);
    expect(splitWords(recording.narration)).toHaveLength(43);
    const words = splitWords(recording.narration);
    const used = new Set<number>();
    let merged: { index: number; span: number } | null = null;
    let secondPost = -1;
    for (const frame of recording.word_timestamps) {
      const match = matchTimestamp(words, frame, used);
      if (frame.word.includes("rent-number")) merged = match;
      if (frame.word === "POST" && match) secondPost = match.index;
    }
    expect(merged).toEqual({ index: 10, span: 2 });
    expect(secondPost).toBe(words.lastIndexOf("POST"));
    expect(secondPost).toBeGreaterThan(10);
  });

  it("fires every catalog cue from the real frames, in order", () => {
    const cases = [
      ...QUESTIONS.map((question) => ({ id: question.id, answer: question.answer })),
      { id: "unknown", answer: unknownAnswer() },
    ];
    for (const item of cases) {
      const recording = loadRecording(item.id);
      expect(recording.narration).toBe(item.answer.narration);
      const scheduler = createCueScheduler({
        narration: recording.narration,
        cues: item.answer.cues,
        msPerChar: 65,
      });
      for (const frame of recording.word_timestamps) scheduler.pushTimestamp(frame);
      const fired: { id: string; atSec: number }[] = [];
      const end = recording.durationSec;
      for (let time = 0; time <= end + 0.05; time += 0.02) {
        for (const event of scheduler.advance(time).cues) {
          fired.push({ id: event.cue.id, atSec: event.atSec });
        }
      }
      expect(fired.map((event) => event.id)).toEqual(item.answer.cues.map((cue) => cue.id));
      for (let index = 1; index < fired.length; index += 1) {
        expect(fired[index].atSec).toBeGreaterThanOrEqual(fired[index - 1].atSec);
      }
    }
  });

  it("keeps latency cues on squeezed frames", () => {
    const recording = loadRecording("latency");
    const frames = recording.word_timestamps;
    const squeezed = frames.filter((frame, index) => index > 0 && frame.start - frames[index - 1].start < 0.1);
    expect(squeezed.length).toBeGreaterThan(0);
    const question = QUESTIONS.find((item) => item.id === "latency");
    expect(question).toBeTruthy();
    const { matches } = align(recording.narration, frames);
    for (const cue of question!.answer.cues) {
      expect(matches.some((item) => item.match && cue.atWord >= item.match.index && cue.atWord < item.match.index + item.match.span)).toBe(
        true,
      );
    }
  });
});
