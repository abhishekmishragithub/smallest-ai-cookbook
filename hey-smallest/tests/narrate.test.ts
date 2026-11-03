import { describe, expect, it, vi } from "vitest";
import { createRateLimiter } from "@/lib/rate-limit";
import { handleNarrate, sanitizeNarration } from "@/lib/narrate-handler";
import { PAGE_TEXT_MAX } from "@/lib/schemas";
import { splitWords } from "@/lib/words";

const page = {
  url: "https://docs.smallest.ai",
  title: "Smallest AI Documentation",
  text: "Lightning streams on the live WebSocket.",
};

function post(body: unknown, headers?: HeadersInit) {
  return handleNarrate(
    new Request("https://hey.example/api/narrate", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://docs.smallest.ai", ...headers },
      body: JSON.stringify(body),
    }),
    {
      env: {},
      fetchImpl: vi.fn() as typeof fetch,
      limiter: createRateLimiter({ limit: 8, windowMs: 60_000 }),
    },
  );
}

describe("POST /api/narrate", () => {
  it("rejects an invalid body and an oversized page text", async () => {
    const missing = await post({ question: "Hi" });
    expect(missing.status).toBe(400);

    const huge = await post({
      question: "How do I stream TTS with Lightning?",
      page: { ...page, text: "a".repeat(PAGE_TEXT_MAX + 1) },
    });
    expect(huge.status).toBe(400);
  });

  it("returns grounded cues whose atWord indexes fall inside the narration", async () => {
    const response = await post({
      question: "How do I stream TTS with Lightning?",
      page,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://docs.smallest.ai");
    const body = (await response.json()) as { narration: string; cues: { id: string; atWord: number; svg?: string }[] };
    const words = splitWords(body.narration);
    expect(body.cues.length).toBeGreaterThan(1);
    expect(body).toMatchObject({ mockId: "lightning" });
    let previous = -1;
    for (const cue of body.cues) {
      expect(cue.atWord).toBeGreaterThan(previous);
      expect(cue.atWord).toBeLessThan(words.length);
      expect(cue.svg).toContain("<svg");
      expect(cue.svg).not.toMatch(/<script/i);
      previous = cue.atWord;
    }
  });

  it("sanitizes svg from a model response and drops a bad atWord", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  narration: "Only the page text is safe.",
                  cues: [
                    {
                      id: "bad-svg",
                      atWord: 0,
                      kind: "diagram",
                      label: "Unsafe",
                      svg: `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect onclick="alert(1)" href="https://evil.test/x" /></svg>`,
                    },
                    {
                      id: "out-of-range",
                      atWord: 40,
                      kind: "highlight",
                      label: "Nope",
                    },
                    {
                      id: "selector",
                      atWord: 1,
                      kind: "arrow",
                      label: "Page",
                      target: "main h1",
                      svg: `<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L10 10"/></svg>`,
                    },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const response = await handleNarrate(
      new Request("https://hey.example/api/narrate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question: "What is the weather in Lisbon tomorrow morning?",
          page,
        }),
      }),
      {
        env: { SMALLEST_API_KEY: "test-key" },
        fetchImpl: fetchImpl as typeof fetch,
        limiter: createRateLimiter({ limit: 5, windowMs: 60_000 }),
      },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      narration: string;
      cues: { id: string; svg?: string; target?: string }[];
    };
    expect(fetchImpl).toHaveBeenCalledOnce();
    const sent = JSON.parse(String(fetchImpl.mock.calls[0]?.[1] && (fetchImpl.mock.calls[0][1] as RequestInit).body));
    expect(sent.model).toBe("electron");
    expect(body.cues.map((cue) => cue.id)).toEqual(["bad-svg", "selector"]);
    expect(body.cues[0]?.svg).not.toMatch(/script|onclick|https:/i);
    expect(body.cues[1]?.target).toBe("main h1");
  });

  it("keeps an Electron answer whose cue id uses underscores", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  narration: "Refunds are described on the billing page.",
                  cues: [{ id: "refund_policy", atWord: 0, kind: "highlight", label: "Refunds" }],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const response = await handleNarrate(
      new Request("https://hey.example/api/narrate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question: "What is the weather in Lisbon tomorrow morning?",
          page,
        }),
      }),
      {
        env: { SMALLEST_API_KEY: "test-key" },
        fetchImpl: fetchImpl as typeof fetch,
        limiter: createRateLimiter({ limit: 5, windowMs: 60_000 }),
      },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { narration: string; cues: { id: string }[] };
    expect(body.narration).toMatch(/Refunds are described/);
    expect(body.cues.map((cue) => cue.id)).toEqual(["refund-policy"]);
    const sent = JSON.parse(String((fetchImpl.mock.calls[0][1] as RequestInit).body));
    expect(sent.messages[0].content).toMatch(/kebab-case/);
  });

  it("drops cues whose atWord is outside the spoken words", () => {
    const clean = sanitizeNarration({
      narration: "Two words",
      cues: [
        { id: "ok", atWord: 1, kind: "highlight", label: "words" },
        { id: "nope", atWord: 3, kind: "diagram", label: "missing" },
      ],
    });
    expect(clean.cues.map((cue) => cue.id)).toEqual(["ok"]);
  });
});
