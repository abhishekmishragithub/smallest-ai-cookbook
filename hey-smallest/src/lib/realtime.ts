import { HEY_SMALLEST_DEFAULTS } from "./schemas";

export function joinEndpoint(endpoint: string, path: string): string {
  const base = endpoint.replace(/\/+$/, "");
  return `${base}${path}`;
}

export function sttSocketUrl(token: string): string {
  const params = new URLSearchParams({
    model: HEY_SMALLEST_DEFAULTS.sttModel,
    language: "en",
    encoding: "linear16",
    sample_rate: String(HEY_SMALLEST_DEFAULTS.sttSampleRate),
    api_key: token,
  });
  return `wss://api.smallest.ai/waves/v1/stt/live?${params.toString()}`;
}

export function ttsSocketUrl(token: string): string {
  const params = new URLSearchParams({ api_key: token });
  return `wss://api.smallest.ai/waves/v1/tts/live?${params.toString()}`;
}

export function ttsRequestBody(text: string, voice: string, model: string) {
  return {
    text,
    voice_id: voice,
    model,
    sample_rate: HEY_SMALLEST_DEFAULTS.sampleRate,
    word_timestamps: true as const,
  };
}

export function pcm16FromBase64(encoded: string): Int16Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const samples = bytes.byteLength - (bytes.byteLength % 2);
  const aligned = new ArrayBuffer(samples);
  new Uint8Array(aligned).set(bytes.subarray(0, samples));
  return new Int16Array(aligned);
}

export function silentPcm(durationSec: number, sampleRate: number): Int16Array {
  const length = Math.max(1, Math.floor(durationSec * sampleRate));
  return new Int16Array(length);
}

export class PcmPlayer {
  private nextTime = 0;
  private startedAt: number | null = null;

  constructor(private readonly context: AudioContext) {}

  elapsed(): number {
    if (this.startedAt === null) return 0;
    return Math.max(0, this.context.currentTime - this.startedAt);
  }

  push(pcm: Int16Array, sampleRate: number): void {
    if (pcm.length === 0) return;
    const buffer = this.context.createBuffer(1, pcm.length, sampleRate);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < pcm.length; index += 1) {
      channel[index] = pcm[index] / 32768;
    }
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    const start = Math.max(this.context.currentTime + 0.02, this.nextTime);
    if (this.startedAt === null) this.startedAt = start;
    source.start(start);
    this.nextTime = start + buffer.duration;
  }

  durationScheduled(): number {
    if (this.startedAt === null) return 0;
    return Math.max(0, this.nextTime - this.startedAt);
  }
}

export function downsampleToPcm16(input: Float32Array, inputRate: number, outputRate: number): Int16Array {
  if (inputRate === outputRate) {
    const same = new Int16Array(input.length);
    for (let index = 0; index < input.length; index += 1) {
      same[index] = floatToInt16(input[index]);
    }
    return same;
  }
  const ratio = inputRate / outputRate;
  const length = Math.floor(input.length / ratio);
  const output = new Int16Array(length);
  for (let index = 0; index < length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(input.length, Math.floor((index + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let sample = start; sample < end; sample += 1) {
      sum += input[sample];
      count += 1;
    }
    output[index] = floatToInt16(count ? sum / count : 0);
  }
  return output;
}

function floatToInt16(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample));
  return clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
}
