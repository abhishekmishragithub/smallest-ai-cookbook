import { DEFAULT_MS_PER_CHAR } from "./cue-scheduler";

/**
 * Audio time used to release cues.
 * Stay at 0 until the player has scheduled a buffer. Wall time before the
 * first chunk is the network wait, not speech, and must not advance cues.
 */
export function audioClockElapsed(input: {
  durationScheduled: number;
  audioElapsed: number;
  elapsedSeen: number;
}): number {
  if (input.durationScheduled <= 0) return 0;
  return Math.max(input.elapsedSeen, input.audioElapsed);
}

/**
 * Upper bound on wall time before giving up. Scales with the narration so a
 * long answer is not cut off at a fixed 45 seconds.
 */
export function wallLimitSec(narration: string, msPerChar = DEFAULT_MS_PER_CHAR): number {
  const estimatedSpeech = Math.max(8, (narration.length * msPerChar) / 1000);
  return estimatedSpeech * 4;
}

export function isPlaybackFinished(input: {
  wallElapsed: number;
  wallLimitSec: number;
  started: boolean;
  /** Monotonic audio elapsed. Ignored until `started`. */
  elapsed: number;
  done: (elapsed: number) => boolean;
}): boolean {
  if (input.wallElapsed > input.wallLimitSec) return true;
  return input.done(input.started ? input.elapsed : input.wallElapsed);
}
