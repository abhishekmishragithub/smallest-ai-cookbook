import { scene, type SceneLine, type SceneNode } from "./diagram";
import type { Cue, NarrateResponse } from "./schemas";
import { normalizeWord, splitWords } from "./words";

export type DemoQuestion = {
  id: string;
  question: string;
  aliases: string[];
  answer: NarrateResponse;
};

const STOP = new Set([
  "how",
  "do",
  "does",
  "i",
  "a",
  "an",
  "the",
  "to",
  "of",
  "and",
  "or",
  "with",
  "my",
  "in",
  "on",
  "for",
  "your",
  "me",
  "get",
]);

function at(narration: string, word: string, occurrence = 0): number {
  const target = normalizeWord(word);
  let seen = 0;
  const words = splitWords(narration);
  for (let index = 0; index < words.length; index += 1) {
    if (normalizeWord(words[index]) !== target) continue;
    if (seen === occurrence) return index;
    seen += 1;
  }
  throw new Error(`Missing word "${word}" occurrence ${occurrence}`);
}

function cue(
  narration: string,
  word: string,
  occurrence: number,
  fields: Omit<Cue, "atWord">,
): Cue {
  return { ...fields, atWord: at(narration, word, occurrence) };
}

function row(labels: { id: string; label: string }[], on: string[], y: number): SceneNode[] {
  const w = labels.length > 3 ? 132 : 156;
  const gap = labels.length > 3 ? 16 : 28;
  const h = 58;
  const total = labels.length * w + (labels.length - 1) * gap;
  let x = Math.round((640 - total) / 2);
  return labels.map((item) => {
    const node: SceneNode = {
      x,
      y,
      w,
      h,
      label: item.label,
      on: on.includes(item.id),
    };
    x += w + gap;
    return node;
  });
}

function connect(nodes: SceneNode[], hot: boolean[]): SceneLine[] {
  const lines: SceneLine[] = [];
  for (let index = 0; index < nodes.length - 1; index += 1) {
    const from = nodes[index];
    const to = nodes[index + 1];
    lines.push({
      x1: from.x + from.w,
      y1: from.y + from.h / 2,
      x2: to.x - 2,
      y2: to.y + to.h / 2,
      on: hot[index] ?? false,
    });
  }
  return lines;
}

const callTop = [
  { id: "caller", label: "Caller" },
  { id: "server", label: "Your server" },
  { id: "socket", label: "WebSocket" },
];
const callBottom = [
  { id: "pulse", label: "Pulse" },
  { id: "electron", label: "Electron" },
  { id: "lightning", label: "Lightning" },
];

function callSvg(id: string, on: string[], note: string): string {
  const top = row(callTop, on, 78);
  const bottom = row(callBottom, on, 210);
  const lines = [
    ...connect(top, [on.includes("server"), on.includes("socket")]),
    ...connect(bottom, [on.includes("electron"), on.includes("lightning")]),
  ];
  return scene(id, [...top, ...bottom], lines, note);
}

const n1 =
  "A voice agent call starts on your server. The server calls register call with the agent id and receives a short lived access token. The browser opens a WebSocket to the agent connect endpoint with that token. Pulse turns speech into text. Electron writes the next turn. Lightning speaks the reply. After the call, fetch the transcript with the call id.";

const n2 =
  "Stream Lightning on the WebSocket at wss://api.smallest.ai/waves/v1/tts/live. Send JSON with voice_id, text, and model lightning_v3.1_pro. Set word_timestamps to true for per word timing. Audio arrives in chunk frames. Each word_timestamp frame carries id, word, start, and end, in seconds. A complete frame ends the utterance. Sync REST and SSE ignore word_timestamps. Use this socket when a diagram must move with speech. Timestamps are available for the voice meher on lightning_v3.1_pro.";

const n3 =
  "Pulse offers streaming and batch. Streaming opens a WebSocket at wss://api.smallest.ai/waves/v1/stt/live?model=pulse and sends PCM audio. You get partial transcripts, then a final. Batch POSTs the whole file to /waves/v1/stt/?model=pulse and returns one transcript. Streaming time to first token is about 150 milliseconds at one concurrency. Pulse Pro is pre recorded English only, and it is not a streaming model. For English end of turn detection, use model pulse-2.";

const n4 =
  "Rent a number from inventory. Read the proration amount first. POST /atoms/v1/product/rent-number with phoneNumber and provider. Then POST /atoms/v1/agent/{agentId}/answers with sourceKind phoneNumber and sourceId. Inbound answering is separate from outbound. Set fromNumber on the outbound call. One number is answered by one agent.";

const n5 =
  "Create a clone with one POST to /waves/v1/voice-cloning as multipart form data. The required parts are displayName and file. Use 5 to 15 seconds of clean audio, under 5 MB. Set language to the language of that sample. The model defaults to lightning-v3.1. Call it with an API key. A wat token receives 403 on this route. Pass the returned voice_id to Lightning as voice_id.";

const n6 =
  "Latency is a stack, not one number. The client round trip sits outside the model and depends on region. Pulse streaming time to first token is about 150 milliseconds at one concurrency, and about 300 milliseconds when many streams run together. Lightning time to first byte is about 200 milliseconds measured in region, in Mumbai or Oregon. A distant laptop often measures 500 to 800 milliseconds because the round trip dominates synthesis. On phone audio, send 8000 hertz PCM instead of upsampling.";

const n7 =
  "Pipecat and LiveKit use one API key for Smallest. Pipecat sends audio to the Pulse live socket and a finalize message when the turn ends. Speech goes out on the Lightning live socket. One turn shares a context_id. Set continue to true on each fragment, then false on the last. LiveKit loads the smallestai plugin, with STT model pulse for streaming. The model pulse-pro is pre recorded only. Keep phone audio at 8000 hertz.";

const n8 =
  "Create your key on the API Keys page. One key covers models and voice agents. Keep it on the server and send it as Authorization Bearer. The browser requests a short lived token from your server. The server calls /console/v1/auth/token and sets ttl_seconds between 30 and 900. Hey Smallest asks for 300 seconds. The access token starts with wat. Browsers pass it as api_key on the WebSocket. Tokens may call TTS and STT. Electron and voice cloning return 403 to a token, so those stay on the server.";

function ttsSvg(id: string, on: string[], note: string): string {
  const nodes = row(
    [
      { id: "client", label: "Client" },
      { id: "socket", label: "tts/live" },
      { id: "frames", label: on.includes("word") ? "word_timestamp" : on.includes("chunk") ? "chunk" : "frames" },
    ],
    on,
    128,
  );
  return scene(id, nodes, connect(nodes, [on.includes("socket"), on.includes("chunk") || on.includes("word")]), note);
}

function pulseSvg(id: string, on: string[], note: string): string {
  const nodes = row(
    [
      { id: "stream", label: "Streaming\nWebSocket" },
      { id: "batch", label: "Batch\nPOST /stt" },
      { id: "pro", label: "Pulse Pro\npre-recorded" },
    ],
    on,
    128,
  );
  return scene(id, nodes, connect(nodes, [false, false]), note);
}

function phoneSvg(id: string, on: string[], note: string): string {
  const nodes = row(
    [
      { id: "rent", label: "Rent number" },
      { id: "answers", label: "Answers on" },
      { id: "from", label: "fromNumber" },
    ],
    on,
    128,
  );
  return scene(
    id,
    nodes,
    connect(nodes, [on.includes("answers"), on.includes("from")]),
    note,
  );
}

function cloneSvg(id: string, on: string[], note: string): string {
  const nodes = row(
    [
      { id: "file", label: "5 to 15 s\naudio" },
      { id: "post", label: "voice-cloning" },
      { id: "voice", label: "voice_id" },
    ],
    on,
    128,
  );
  return scene(id, nodes, connect(nodes, [on.includes("post") || on.includes("file"), on.includes("voice")]), note);
}

function latencySvg(id: string, on: string[], note: string): string {
  const bars: SceneNode[] = [
    { x: 36, y: 56, w: on.includes("trip") ? 520 : 560, h: 40, label: "Round trip, outside the model", on: on.includes("trip") },
    { x: 36, y: 112, w: 300, h: 40, label: "Pulse, about 150 ms", on: on.includes("pulse") },
    { x: 36, y: 168, w: 360, h: 40, label: "Lightning, about 200 ms in region", on: on.includes("lightning") },
    { x: 36, y: 224, w: 420, h: 40, label: "Distant laptop, often 500 to 800 ms", on: on.includes("laptop") },
    { x: 36, y: 280, w: 240, h: 36, label: "Phone audio at 8000 Hz", on: on.includes("phone") },
  ];
  return scene(id, bars, [], note);
}

function integrateSvg(id: string, on: string[], note: string): string {
  const nodes = row(
    [
      { id: "pipecat", label: "Pipecat" },
      { id: "livekit", label: "LiveKit" },
      { id: "key", label: "One API key" },
    ],
    on,
    128,
  );
  return scene(id, nodes, connect(nodes, [false, on.includes("key")]), note);
}

function authSvg(id: string, on: string[], note: string): string {
  const nodes = row(
    [
      { id: "browser", label: "Browser" },
      { id: "server", label: "Your server" },
      { id: "wat", label: "wat token" },
    ],
    on,
    128,
  );
  return scene(id, nodes, connect(nodes, [on.includes("server"), on.includes("wat")]), note);
}

function demo(id: string, question: string, aliases: string[], answer: NarrateResponse): DemoQuestion {
  return { id, question, aliases, answer };
}

export const QUESTIONS: DemoQuestion[] = [
  demo("call-flow", "How does a voice agent call flow end to end?", ["voice agent call", "register call", "end to end"], {
    narration: n1,
    cues: [
      cue(n1, "server", 0, {
        id: "call-server",
        kind: "diagram",
        label: "Your server starts the call",
        svg: callSvg("call-server", ["caller", "server"], "Register the session on the server."),
      }),
      cue(n1, "token", 0, {
        id: "call-token",
        kind: "highlight",
        label: "Short lived access token",
        svg: callSvg("call-token", ["server"], "register-call returns a short lived token."),
      }),
      cue(n1, "WebSocket", 0, {
        id: "call-socket",
        kind: "arrow",
        label: "Agent connect socket",
        svg: callSvg("call-socket", ["server", "socket"], "Browser opens the agent WebSocket with the token."),
      }),
      cue(n1, "Pulse", 0, {
        id: "call-pulse",
        kind: "diagram",
        label: "Pulse hears the caller",
        svg: callSvg("call-pulse", ["socket", "pulse"], "Pulse turns speech into text."),
      }),
      cue(n1, "Electron", 0, {
        id: "call-electron",
        kind: "diagram",
        label: "Electron writes the turn",
        svg: callSvg("call-electron", ["pulse", "electron"], "Electron plans the next thing to say."),
      }),
      cue(n1, "Lightning", 0, {
        id: "call-lightning",
        kind: "diagram",
        label: "Lightning speaks",
        svg: callSvg("call-lightning", ["electron", "lightning"], "Lightning speaks the reply."),
      }),
      cue(n1, "transcript", 0, {
        id: "call-transcript",
        kind: "highlight",
        label: "Transcript after the call",
        svg: callSvg("call-transcript", ["caller", "server", "socket", "pulse", "electron", "lightning"], "Fetch transcript and recording with the call id."),
      }),
    ],
  }),
  demo("lightning", "How do I stream TTS with Lightning?", ["lightning", "stream tts", "word timestamps", "tts live"], {
    narration: n2,
    cues: [
      cue(n2, "WebSocket", 0, {
        id: "tts-socket",
        kind: "diagram",
        label: "Live TTS socket",
        svg: ttsSvg("tts-socket", ["client", "socket"], "wss://api.smallest.ai/waves/v1/tts/live"),
      }),
      cue(n2, "lightning_v3.1_pro", 0, {
        id: "tts-model",
        kind: "highlight",
        label: "lightning_v3.1_pro",
        svg: ttsSvg("tts-model", ["socket"], "model is lightning_v3.1_pro for word timestamps."),
      }),
      cue(n2, "word_timestamps", 0, {
        id: "tts-flag",
        kind: "highlight",
        label: "word_timestamps true",
        svg: ttsSvg("tts-flag", ["socket", "frames"], "Set word_timestamps to true on the socket."),
      }),
      cue(n2, "chunk", 0, {
        id: "tts-chunk",
        kind: "diagram",
        label: "Audio chunks",
        svg: ttsSvg("tts-chunk", ["socket", "chunk"], "Audio arrives as chunk frames."),
      }),
      cue(n2, "word_timestamp", 0, {
        id: "tts-word",
        kind: "arrow",
        label: "Word timing",
        svg: ttsSvg("tts-word", ["chunk", "word"], "id, word, start, and end, in seconds."),
      }),
      cue(n2, "REST", 0, {
        id: "tts-rest",
        kind: "highlight",
        label: "REST and SSE ignore the flag",
        svg: ttsSvg("tts-rest", ["client"], "Sync REST and SSE ignore word_timestamps."),
      }),
      cue(n2, "meher", 0, {
        id: "tts-voice",
        kind: "highlight",
        label: "Voice meher",
        svg: ttsSvg("tts-voice", ["frames"], "meher emits timestamps on lightning_v3.1_pro."),
      }),
    ],
  }),
  demo("pulse", "Pulse streaming vs batch STT?", ["pulse streaming", "batch stt", "pulse pro", "pulse-2"], {
    narration: n3,
    cues: [
      cue(n3, "streaming", 0, {
        id: "stt-stream",
        kind: "diagram",
        label: "Streaming socket",
        svg: pulseSvg("stt-stream", ["stream"], "wss://api.smallest.ai/waves/v1/stt/live?model=pulse"),
      }),
      cue(n3, "WebSocket", 0, {
        id: "stt-socket",
        kind: "arrow",
        label: "PCM in, partials out",
        svg: pulseSvg("stt-socket", ["stream"], "Send PCM. Receive partials, then a final."),
      }),
      cue(n3, "Batch", 1, {
        id: "stt-batch",
        kind: "diagram",
        label: "Batch file",
        svg: pulseSvg("stt-batch", ["batch"], "POST /waves/v1/stt/?model=pulse"),
      }),
      cue(n3, "150", 0, {
        id: "stt-latency",
        kind: "highlight",
        label: "About 150 ms",
        svg: pulseSvg("stt-latency", ["stream"], "About 150 ms to first token at one concurrency."),
      }),
      cue(n3, "Pro", 0, {
        id: "stt-pro",
        kind: "highlight",
        label: "Pulse Pro is pre-recorded",
        svg: pulseSvg("stt-pro", ["pro"], "Pulse Pro is English and pre-recorded only."),
      }),
      cue(n3, "pulse-2", 0, {
        id: "stt-pulse2",
        kind: "highlight",
        label: "pulse-2 end of turn",
        svg: pulseSvg("stt-pulse2", ["stream"], "pulse-2 adds English end of turn detection."),
      }),
    ],
  }),
  demo("phone", "How do I connect Atoms to my phone number?", ["phone number", "rent a number", "fromnumber", "answers"], {
    narration: n4,
    cues: [
      cue(n4, "Rent", 0, {
        id: "phone-rent",
        kind: "diagram",
        label: "Rent from inventory",
        svg: phoneSvg("phone-rent", ["rent"], "Rent first. Read the proration amount."),
      }),
      cue(n4, "proration", 0, {
        id: "phone-proration",
        kind: "highlight",
        label: "Proration amount",
        svg: phoneSvg("phone-proration", ["rent"], "Surface the immediate charge before renting."),
      }),
      cue(n4, "phoneNumber", 0, {
        id: "phone-body",
        kind: "highlight",
        label: "phoneNumber and provider",
        svg: phoneSvg("phone-body", ["rent"], "POST /atoms/v1/product/rent-number"),
      }),
      cue(n4, "sourceKind", 0, {
        id: "phone-answers",
        kind: "arrow",
        label: "Who answers",
        svg: phoneSvg("phone-answers", ["rent", "answers"], "POST /agent/{agentId}/answers"),
      }),
      cue(n4, "fromNumber", 0, {
        id: "phone-from",
        kind: "diagram",
        label: "Outbound caller id",
        svg: phoneSvg("phone-from", ["from"], "fromNumber is set on the outbound call."),
      }),
      cue(n4, "One", 0, {
        id: "phone-one",
        kind: "highlight",
        label: "One agent per number",
        svg: phoneSvg("phone-one", ["answers"], "One number is answered by one agent."),
      }),
    ],
  }),
  demo("clone", "How do I add a custom voice or voice clone?", ["voice clone", "voice cloning", "custom voice", "displayname"], {
    narration: n5,
    cues: [
      cue(n5, "displayName", 0, {
        id: "clone-name",
        kind: "diagram",
        label: "displayName and file",
        svg: cloneSvg("clone-name", ["file", "post"], "POST /waves/v1/voice-cloning"),
      }),
      cue(n5, "file", 0, {
        id: "clone-file",
        kind: "highlight",
        label: "5 to 15 seconds",
        svg: cloneSvg("clone-file", ["file"], "Clean audio, 5 to 15 seconds, under 5 MB."),
      }),
      cue(n5, "language", 0, {
        id: "clone-language",
        kind: "highlight",
        label: "Sample language",
        svg: cloneSvg("clone-language", ["file", "post"], "Set language to the sample language."),
      }),
      cue(n5, "lightning-v3.1", 0, {
        id: "clone-model",
        kind: "diagram",
        label: "Defaults to lightning-v3.1",
        svg: cloneSvg("clone-model", ["post"], "The clone model defaults to lightning-v3.1."),
      }),
      cue(n5, "403", 0, {
        id: "clone-token",
        kind: "highlight",
        label: "Tokens receive 403",
        svg: cloneSvg("clone-token", ["post"], "A wat token cannot clone a voice."),
      }),
      cue(n5, "voice_id", 0, {
        id: "clone-id",
        kind: "arrow",
        label: "Use voice_id",
        svg: cloneSvg("clone-id", ["post", "voice"], "Pass voice_id on a later Lightning request."),
      }),
    ],
  }),
  demo("latency", "How does latency break down in a voice pipeline?", ["latency", "time to first byte", "round trip"], {
    narration: n6,
    cues: [
      cue(n6, "stack", 0, {
        id: "lat-stack",
        kind: "diagram",
        label: "A stack of delays",
        svg: latencySvg("lat-stack", ["trip"], "Round trip sits outside the model."),
      }),
      cue(n6, "Pulse", 0, {
        id: "lat-pulse",
        kind: "highlight",
        label: "Pulse, about 150 ms",
        svg: latencySvg("lat-pulse", ["pulse"], "About 150 ms at one concurrency, about 300 when busy."),
      }),
      cue(n6, "Lightning", 0, {
        id: "lat-lightning",
        kind: "highlight",
        label: "Lightning, about 200 ms",
        svg: latencySvg("lat-lightning", ["lightning"], "About 200 ms in region, Mumbai or Oregon."),
      }),
      cue(n6, "laptop", 0, {
        id: "lat-laptop",
        kind: "diagram",
        label: "Laptop measurements",
        svg: latencySvg("lat-laptop", ["laptop"], "A far laptop often sees 500 to 800 ms."),
      }),
      cue(n6, "8000", 0, {
        id: "lat-phone",
        kind: "highlight",
        label: "8000 Hz on the phone",
        svg: latencySvg("lat-phone", ["phone"], "Send 8000 Hz PCM. Do not upsample telephone audio."),
      }),
    ],
  }),
  demo("integrations", "How do I use Smallest with Pipecat or LiveKit?", ["pipecat", "livekit", "context_id"], {
    narration: n7,
    cues: [
      cue(n7, "Pipecat", 0, {
        id: "int-both",
        kind: "diagram",
        label: "One API key",
        svg: integrateSvg("int-both", ["pipecat", "livekit", "key"], "Both frameworks use one Smallest API key."),
      }),
      cue(n7, "Pulse", 0, {
        id: "int-pulse",
        kind: "highlight",
        label: "Pipecat hears with Pulse",
        svg: integrateSvg("int-pulse", ["pipecat"], "Pulse live socket, then a finalize at end of turn."),
      }),
      cue(n7, "Lightning", 0, {
        id: "int-lightning",
        kind: "highlight",
        label: "Pipecat speaks with Lightning",
        svg: integrateSvg("int-lightning", ["pipecat"], "Lightning live socket for speech out."),
      }),
      cue(n7, "context_id", 0, {
        id: "int-context",
        kind: "arrow",
        label: "One turn, one context",
        svg: integrateSvg("int-context", ["pipecat"], "Share context_id. continue true, then false."),
      }),
      cue(n7, "LiveKit", 1, {
        id: "int-livekit",
        kind: "diagram",
        label: "LiveKit plugin",
        svg: integrateSvg("int-livekit", ["livekit"], "smallestai STT and TTS. Model pulse streams."),
      }),
      cue(n7, "pulse-pro", 0, {
        id: "int-pro",
        kind: "highlight",
        label: "pulse-pro is pre-recorded",
        svg: integrateSvg("int-pro", ["livekit"], "pulse-pro does not stream."),
      }),
      cue(n7, "8000", 0, {
        id: "int-phone",
        kind: "highlight",
        label: "8000 Hz telephony",
        svg: integrateSvg("int-phone", ["livekit", "pipecat"], "Keep telephone audio at 8000 Hz."),
      }),
    ],
  }),
  demo("auth", "How do I authenticate and get an API key?", ["api key", "authenticate", "access token", "wat"], {
    narration: n8,
    cues: [
      cue(n8, "server", 0, {
        id: "auth-server",
        kind: "diagram",
        label: "Key stays on the server",
        svg: authSvg("auth-server", ["server"], "Send Authorization Bearer from the server."),
      }),
      cue(n8, "token", 0, {
        id: "auth-token",
        kind: "highlight",
        label: "Browser asks for a token",
        svg: authSvg("auth-token", ["browser", "server"], "The browser never sees the API key."),
      }),
      cue(n8, "ttl_seconds", 0, {
        id: "auth-ttl",
        kind: "highlight",
        label: "ttl_seconds 30 to 900",
        svg: authSvg("auth-ttl", ["server"], "POST /console/v1/auth/token. This demo uses at most 300."),
      }),
      cue(n8, "wat", 0, {
        id: "auth-wat",
        kind: "diagram",
        label: "wat token",
        svg: authSvg("auth-wat", ["server", "wat"], "The access token starts with wat."),
      }),
      cue(n8, "api_key", 0, {
        id: "auth-query",
        kind: "arrow",
        label: "api_key on the WebSocket",
        svg: authSvg("auth-query", ["browser", "wat"], "Browsers pass the token as the api_key query."),
      }),
      cue(n8, "403", 0, {
        id: "auth-403",
        kind: "highlight",
        label: "LLM and cloning stay server side",
        svg: authSvg("auth-403", ["server"], "Electron and voice cloning return 403 to a token."),
      }),
    ],
  }),
];

const unknownNarration =
  "This demo can walk through eight questions about Smallest. Pick a suggested question to hear the call flow, Lightning streaming, Pulse, phone numbers, voice cloning, latency, Pipecat or LiveKit, and API keys.";

export function unknownAnswer(): NarrateResponse {
  const topics = row(
    [
      { id: "a", label: "Call flow" },
      { id: "b", label: "Lightning" },
      { id: "c", label: "Pulse" },
      { id: "d", label: "Phone" },
    ],
    [],
    88,
  );
  const topics2 = row(
    [
      { id: "e", label: "Clone" },
      { id: "f", label: "Latency" },
      { id: "g", label: "Frameworks" },
      { id: "h", label: "API key" },
    ],
    [],
    190,
  );
  return {
    narration: unknownNarration,
    cues: [
      {
        id: "unknown-topics",
        atWord: at(unknownNarration, "eight", 0),
        kind: "diagram",
        label: "Suggested questions",
        svg: scene("unknown-topics", [...topics, ...topics2], [], "Choose one of the eight questions."),
      },
    ],
  };
}

export function fold(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function contentTokens(value: string): string[] {
  return value
    .split(/\s+/)
    .map((word) => normalizeWord(word))
    .filter((word) => word.length > 1 && !STOP.has(word));
}

export function matchQuestion(question: string): DemoQuestion | null {
  const folded = fold(question);
  if (!folded) return null;

  let best: { item: DemoQuestion; score: number } | null = null;
  for (const item of QUESTIONS) {
    if (fold(item.question) === folded) return item;
    let score = 0;
    for (const alias of item.aliases) {
      if (folded.includes(fold(alias))) score = Math.max(score, 0.85);
    }
    const wanted = contentTokens(question);
    const canon = new Set(contentTokens(item.question));
    if (wanted.length > 0) {
      const hits = wanted.filter((token) => canon.has(token)).length;
      score = Math.max(score, hits / wanted.length);
    }
    if (!best || score > best.score) best = { item, score };
  }
  return best && best.score >= 0.6 ? best.item : null;
}

export const PAGE_BRIEF = [
  "Smallest AI docs, models and voice agents.",
  "Lightning TTS streams on wss://api.smallest.ai/waves/v1/tts/live. Sync is POST /waves/v1/tts. SSE is POST /waves/v1/tts/live. Word timestamps need the WebSocket, word_timestamps true, model lightning_v3.1_pro, and a base voice such as meher. REST and SSE ignore the flag. In region time to first byte is about 200 ms. Client round trip adds on top. A distant laptop often sees 500 to 800 ms.",
  "Pulse streaming is wss://api.smallest.ai/waves/v1/stt/live?model=pulse. Batch is POST /waves/v1/stt/?model=pulse. Streaming time to first token is about 150 ms at one concurrency and about 300 ms when busy. Pulse Pro is pre-recorded English only. pulse-2 is English streaming with end of turn detection.",
  "Voice agents: the server registers the call, the browser opens the agent WebSocket with a short lived token, Pulse transcribes, Electron plans the turn, Lightning speaks. After the call, transcript and recording are available by call id.",
  "Phone numbers: read proration, POST /atoms/v1/product/rent-number with phoneNumber and provider, then POST /atoms/v1/agent/{agentId}/answers with sourceKind phoneNumber and sourceId. Outbound caller id is fromNumber on the call. One number is answered by one agent.",
  "Voice cloning: POST /waves/v1/voice-cloning multipart with displayName and file. Sample is 5 to 15 seconds, under 5 MB. language should match the sample. Default model lightning-v3.1. API key required. wat tokens receive 403. Use the returned voice_id on Lightning.",
  "Pipecat uses one SMALLEST_API_KEY. STT is the Pulse live socket with finalize at end of turn. TTS is the Lightning live socket. Fragments share context_id and continue true until the last fragment. LiveKit uses the smallestai plugin. STT model pulse streams. pulse-pro is batch only. Telephone audio stays at 8000 Hz.",
  "Auth: create a key on the API Keys page. Server sends Authorization Bearer. Browser tokens come from POST /console/v1/auth/token with ttl_seconds from 30 to 900. The token starts with wat and is passed as api_key on WebSockets. Tokens can call TTS, STT, and speech to speech. Electron and voice cloning return 403.",
].join(" ");
