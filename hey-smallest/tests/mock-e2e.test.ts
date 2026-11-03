import { describe, expect, it } from "vitest";
import { QUESTIONS } from "@/lib/catalog";
import { createCueScheduler } from "@/lib/cue-scheduler";
import { HEY_SMALLEST_DEFAULTS } from "@/lib/schemas";
import { ttsRequestBody, sttSocketUrl } from "@/lib/realtime";
import { syntheticTimestamps } from "@/lib/words";
import { handleNarrate } from "@/lib/narrate-handler";
import { createRateLimiter } from "@/lib/rate-limit";

describe("mock mode end to end", () => {
  it("fires every demo cue in order from synthetic word timestamps", async () => {
    for (const question of QUESTIONS) {
      const response = await handleNarrate(
        new Request("http://localhost/api/narrate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            question: question.question,
            page: { url: "https://docs.smallest.ai", title: "Docs", text: "Smallest docs" },
          }),
        }),
        { env: {}, fetchImpl: fetch, limiter: createRateLimiter({ limit: 20, windowMs: 60_000 }) },
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as { narration: string; cues: { id: string; atWord: number }[] };
      const frames = syntheticTimestamps(body.narration, 22);
      const scheduler = createCueScheduler({ narration: body.narration, cues: body.cues, msPerChar: 22 });
      for (const frame of frames) scheduler.pushTimestamp(frame);

      const fired: string[] = [];
      const end = frames.at(-1)?.end ?? 0;
      for (let time = 0; time <= end + 0.05; time += 0.02) {
        for (const event of scheduler.advance(time).cues) fired.push(event.cue.id);
      }
      expect(fired).toEqual(body.cues.map((cue) => cue.id));
    }
  });

  it("asks Pulse for speech to text and Lightning for word timestamps", () => {
    const stt = new URL(sttSocketUrl("wat_test"));
    expect(stt.searchParams.get("model")).toBe("pulse");
    expect(stt.searchParams.get("model")).not.toBe("pulse-pro");
    expect(stt.searchParams.get("api_key")).toBe("wat_test");
    expect(ttsRequestBody("Hello", HEY_SMALLEST_DEFAULTS.voice, HEY_SMALLEST_DEFAULTS.model)).toEqual({
      text: "Hello",
      voice_id: "meher",
      model: "lightning_v3.1_pro",
      sample_rate: 24000,
      word_timestamps: true,
    });
  });
});
