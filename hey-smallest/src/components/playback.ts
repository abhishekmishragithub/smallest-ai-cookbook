import { createCueScheduler } from "@/lib/cue-scheduler";
import { audioClockElapsed, isPlaybackFinished, wallLimitSec } from "@/lib/playback-clock";
import type { Cue } from "@/lib/schemas";
import { HEY_SMALLEST_DEFAULTS } from "@/lib/schemas";
import {
  pcm16FromBase64,
  PcmPlayer,
  silentPcm,
  sttSocketUrl,
  ttsRequestBody,
  ttsSocketUrl,
} from "@/lib/realtime";
import { splitWords, syntheticTimestamps, type WordTimestamp } from "@/lib/words";

export type TokenPayload = {
  token: string | null;
  expires_at: string | null;
  mode?: "live" | "mock";
};

export async function fetchToken(endpoint: string, signal: AbortSignal): Promise<TokenPayload> {
  const response = await fetch(join(endpoint, "/api/token"), { method: "POST", signal });
  const body = (await response.json()) as TokenPayload;
  if (body.mode === "mock" || !body.token) return { token: null, expires_at: null, mode: "mock" };
  if (!response.ok) throw new Error("Token request failed.");
  return body;
}

export type NarrationPayload = {
  narration: string;
  cues: Cue[];
  mockId?: string;
};

export async function fetchNarration(
  endpoint: string,
  question: string,
  page: { url: string; title: string; text: string },
  signal: AbortSignal,
): Promise<NarrationPayload> {
  const response = await fetch(join(endpoint, "/api/narrate"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, page }),
    signal,
  });
  const body = (await response.json()) as NarrationPayload & { error?: string };
  if (!response.ok || typeof body.narration !== "string" || !Array.isArray(body.cues)) {
    throw new Error(body.error || "Narration failed.");
  }
  const mockId = typeof body.mockId === "string" && /^[a-z0-9-]+$/.test(body.mockId) ? body.mockId : undefined;
  return { narration: body.narration, cues: body.cues, mockId };
}

export type PlaybackTick = {
  caption: string;
  latestWord: string;
  cueId: string | null;
  cue: Cue | null;
};

export async function playNarration(options: {
  endpoint: string;
  narration: string;
  cues: Cue[];
  voice: string;
  model: string;
  context: AudioContext;
  signal: AbortSignal;
  msPerChar: number;
  mockId?: string;
  onTick: (tick: PlaybackTick) => void;
}): Promise<"live" | "mock"> {
  const token = await fetchToken(options.endpoint, options.signal);
  if (options.signal.aborted) throw abortError();
  if (!token.token) {
    const clip = options.mockId ? await loadMockClip(options.endpoint, options.mockId, options.context, options.signal) : null;
    if (clip) {
      await playWithTimestamps(options, clip.frames, clip.pcm, clip.sampleRate);
    } else {
      console.warn(
        `Hey Smallest is using silent fallback audio${options.mockId ? ` for ${options.mockId}` : ""}. The mock recording did not load.`,
      );
      const frames = syntheticTimestamps(options.narration, options.msPerChar);
      const duration = silentDuration(options.narration, options.msPerChar);
      const rate = options.context.sampleRate || HEY_SMALLEST_DEFAULTS.sampleRate;
      await playWithTimestamps(options, frames, silentPcm(duration, rate), rate);
    }
    return "mock";
  }
  await playLive(options, token.token);
  return "live";
}

type MockClip = {
  frames: WordTimestamp[];
  pcm: Int16Array;
  sampleRate: number;
};

async function loadMockClip(
  endpoint: string,
  mockId: string,
  context: AudioContext,
  signal: AbortSignal,
): Promise<MockClip | null> {
  try {
    const [audioRes, timeRes] = await Promise.all([
      fetch(join(endpoint, `/mock-audio/${mockId}.mp3`), { signal }),
      fetch(join(endpoint, `/mock-audio/${mockId}.timestamps.json`), { signal }),
    ]);
    if (!audioRes.ok || !timeRes.ok) return null;
    const payload = (await timeRes.json()) as { word_timestamps?: WordTimestamp[] };
    const frames = Array.isArray(payload.word_timestamps) ? payload.word_timestamps : [];
    if (frames.length === 0) return null;
    const bytes = await audioRes.arrayBuffer();
    const decoded = await context.decodeAudioData(bytes.slice(0));
    const pcm = audioBufferToPcm16(decoded);
    return { frames, pcm, sampleRate: decoded.sampleRate };
  } catch {
    return null;
  }
}

function audioBufferToPcm16(buffer: AudioBuffer): Int16Array {
  const channel = buffer.numberOfChannels > 0 ? buffer.getChannelData(0) : new Float32Array();
  const pcm = new Int16Array(channel.length);
  for (let index = 0; index < channel.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, channel[index]));
    pcm[index] = sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
  }
  return pcm;
}

async function playWithTimestamps(
  options: {
    narration: string;
    cues: Cue[];
    context: AudioContext;
    signal: AbortSignal;
    msPerChar: number;
    onTick: (tick: PlaybackTick) => void;
  },
  frames: WordTimestamp[],
  pcm: Int16Array,
  sampleRate: number,
): Promise<void> {
  const scheduler = createCueScheduler({
    narration: options.narration,
    cues: options.cues,
    msPerChar: options.msPerChar,
  });
  for (const frame of frames) scheduler.pushTimestamp(frame);
  const player = new PcmPlayer(options.context);
  player.push(pcm, sampleRate);
  const duration = player.durationScheduled();
  await follow(options, player, scheduler, (elapsed) => elapsed + 0.05 >= Math.max(duration, 0.2));
}

async function playLive(
  options: {
    narration: string;
    cues: Cue[];
    voice: string;
    model: string;
    context: AudioContext;
    signal: AbortSignal;
    msPerChar: number;
    onTick: (tick: PlaybackTick) => void;
  },
  token: string,
): Promise<void> {
  const scheduler = createCueScheduler({
    narration: options.narration,
    cues: options.cues,
    msPerChar: options.msPerChar,
  });
  const player = new PcmPlayer(options.context);
  const socket = new WebSocket(ttsSocketUrl(token));
  let streamDone = false;
  let failed: Error | null = null;

  const closed = new Promise<void>((resolve) => {
    const fail = (error: Error) => {
      failed = error;
      socket.close();
    };
    options.signal.addEventListener("abort", () => {
      socket.close();
    });
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify(ttsRequestBody(options.narration, options.voice, options.model)));
    });
    socket.addEventListener("message", (event) => {
      void readMessage(event.data).then((text) => {
        const frame = JSON.parse(text) as {
          status?: string;
          error?: { message?: string };
          data?: { audio?: string; id?: number; word?: string; start?: number; end?: number };
        };
        if (frame.status === "error") {
          fail(new Error(frame.error?.message || "Speech failed."));
          socket.close();
          return;
        }
        if (frame.status === "chunk" && frame.data?.audio) {
          player.push(pcm16FromBase64(frame.data.audio), HEY_SMALLEST_DEFAULTS.sampleRate);
        }
        if (
          frame.status === "word_timestamp" &&
          typeof frame.data?.id === "number" &&
          typeof frame.data.word === "string" &&
          typeof frame.data.start === "number" &&
          typeof frame.data.end === "number"
        ) {
          scheduler.pushTimestamp({
            id: frame.data.id,
            word: frame.data.word,
            start: frame.data.start,
            end: frame.data.end,
          });
        }
        if (frame.status === "complete") {
          streamDone = true;
          socket.close();
        }
      }).catch((error: unknown) => {
        fail(error instanceof Error ? error : new Error("Speech failed."));
      });
    });
    socket.addEventListener("error", () => fail(new Error("Speech socket failed.")));
    socket.addEventListener("close", () => resolve());
  });

  try {
    await follow(options, player, scheduler, (elapsed) => {
      if (failed || options.signal.aborted) return true;
      if (!streamDone) return false;
      const scheduled = player.durationScheduled();
      if (scheduled <= 0.05) return elapsed > 0.3;
      return elapsed + 0.05 >= scheduled;
    });
  } finally {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
  }
  await closed;
  if (options.signal.aborted) throw abortError();
  if (failed) throw failed;
}

async function follow(
  options: {
    narration: string;
    signal: AbortSignal;
    onTick: (tick: PlaybackTick) => void;
  },
  player: PcmPlayer,
  scheduler: ReturnType<typeof createCueScheduler>,
  done: (elapsed: number) => boolean,
): Promise<void> {
  const words = splitWords(options.narration);
  let cueId: string | null = null;
  const wallStart = performance.now();
  let elapsedSeen = 0;
  await new Promise<void>((resolve, reject) => {
    const step = () => {
      if (options.signal.aborted) {
        reject(abortError());
        return;
      }
      const audioElapsed = player.elapsed();
      const wallElapsed = (performance.now() - wallStart) / 1000;
      const started = player.durationScheduled() > 0;
      const elapsed = audioClockElapsed({
        durationScheduled: player.durationScheduled(),
        audioElapsed,
        elapsedSeen,
      });
      elapsedSeen = elapsed;
      const finished = isPlaybackFinished({
        wallElapsed,
        wallLimitSec: wallLimitSec(options.narration),
        started,
        elapsed,
        done,
      });
      const tick = finished ? scheduler.complete(elapsed) : scheduler.advance(elapsed);
      const cue = tick.cues.at(-1)?.cue ?? null;
      if (cue) cueId = cue.id;
      const wordIndex = tick.wordIndex;
      const caption = wordIndex >= 0 ? words.slice(0, wordIndex + 1).join(" ") : "";
      const latestWord = wordIndex >= 0 ? words[wordIndex] : "";
      if (caption || cue) {
        options.onTick({ caption, latestWord, cueId, cue });
      }
      if (finished) {
        resolve();
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

function silentDuration(narration: string, msPerChar: number): number {
  const frames = syntheticTimestamps(narration, msPerChar);
  return (frames.at(-1)?.end ?? 0.4) + 0.08;
}

export function startMicrophone(options: {
  token: string;
  signal: AbortSignal;
  onPartial: (text: string) => void;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(sttSocketUrl(options.token));
    let context: AudioContext | null = null;
    let stream: MediaStream | null = null;
    const finals: string[] = [];
    let partial = "";
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      stream?.getTracks().forEach((track) => track.stop());
      if (context && context.state !== "closed") void context.close();
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
      if (error && !isAbort(error)) reject(error);
      else resolve((finals.join(" ") || partial).trim());
    };

    options.signal.addEventListener("abort", () => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "close_stream" }));
        window.setTimeout(() => finish(), 900);
      } else {
        finish();
      }
    });

    socket.addEventListener("open", () => {
      void navigator.mediaDevices
        .getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
        .then((media) => {
          stream = media;
          context = new AudioContext();
          const source = context.createMediaStreamSource(media);
          const processor = context.createScriptProcessor(4096, 1, 1);
          const gain = context.createGain();
          gain.gain.value = 0;
          source.connect(processor);
          processor.connect(gain);
          gain.connect(context.destination);
          let heard = false;
          let quietSince = 0;
          processor.onaudioprocess = (event) => {
            if (socket.readyState !== WebSocket.OPEN) return;
            const channel = event.inputBuffer.getChannelData(0);
            const pcm = downsample(channel, context?.sampleRate ?? 48000);
            socket.send(pcm.buffer);
            const rms = energy(channel);
            const now = performance.now();
            if (rms > 0.02) {
              heard = true;
              quietSince = 0;
            } else if (heard) {
              if (!quietSince) quietSince = now;
              if (now - quietSince > 1200) {
                socket.send(JSON.stringify({ type: "close_stream" }));
              }
            }
          };
        })
        .catch((error: unknown) => {
          finish(error instanceof Error ? error : new Error("Microphone failed."));
        });
    });

    socket.addEventListener("message", (event) => {
      void readMessage(event.data).then((text) => {
        const data = JSON.parse(text) as { transcript?: string; is_final?: boolean; is_last?: boolean };
        if (typeof data.transcript === "string" && data.transcript) {
          if (data.is_final) {
            finals.push(data.transcript);
            partial = "";
          } else {
            partial = data.transcript;
          }
          options.onPartial((finals.join(" ") + " " + partial).trim());
        }
        if (data.is_last) finish();
      }).catch(() => undefined);
    });

    socket.addEventListener("error", () => finish(new Error("Transcription socket failed.")));
    socket.addEventListener("close", () => finish());
  });
}

function downsample(input: Float32Array, inputRate: number): Int16Array {
  const outputRate = HEY_SMALLEST_DEFAULTS.sttSampleRate;
  if (inputRate === outputRate) {
    const same = new Int16Array(input.length);
    for (let index = 0; index < input.length; index += 1) same[index] = toInt16(input[index]);
    return same;
  }
  const ratio = inputRate / outputRate;
  const length = Math.max(1, Math.floor(input.length / ratio));
  const output = new Int16Array(length);
  for (let index = 0; index < length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(input.length, Math.max(start + 1, Math.floor((index + 1) * ratio)));
    let sum = 0;
    for (let sample = start; sample < end; sample += 1) sum += input[sample];
    output[index] = toInt16(sum / (end - start));
  }
  return output;
}

function toInt16(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample));
  return clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
}

function energy(channel: Float32Array): number {
  let sum = 0;
  for (let index = 0; index < channel.length; index += 1) sum += channel[index] * channel[index];
  return Math.sqrt(sum / channel.length);
}

async function readMessage(data: unknown): Promise<string> {
  if (typeof data === "string") return data;
  if (data instanceof Blob) return data.text();
  return String(data);
}

function join(endpoint: string, path: string): string {
  return `${endpoint.replace(/\/+$/, "")}${path}`;
}

function abortError(): Error {
  const error = new Error("Aborted");
  error.name = "AbortError";
  return error;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
