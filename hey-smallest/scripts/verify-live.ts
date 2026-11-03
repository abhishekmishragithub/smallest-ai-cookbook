/**
 * Live check for Lightning word timestamps and a Pulse socket handshake.
 * Run with a real key: SMALLEST_API_KEY=... npm run verify-live
 * This script does not print the key or the full token.
 */
import WebSocket from "ws";

const key = process.env.SMALLEST_API_KEY;
if (!key) {
  console.error("SMALLEST_API_KEY is not set. Mock mode does not call the live API.");
  process.exit(1);
}

const text = "Lightning can mark each spoken word.";
const ttl = 120;

const minted = await fetch("https://api.smallest.ai/console/v1/auth/token", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ ttl_seconds: ttl }),
});

if (!minted.ok) {
  console.error(`Token mint failed with HTTP ${minted.status}.`);
  process.exit(1);
}

const tokenBody = (await minted.json()) as { access_token?: string; expires_at?: string; expires_in?: number };
if (!tokenBody.access_token?.startsWith("wat_")) {
  console.error("Mint response did not include a wat_ access token.");
  process.exit(1);
}
if ((tokenBody.expires_in ?? ttl) > 300) {
  console.error("Token TTL is above 300 seconds.");
  process.exit(1);
}

console.log(`Minted wat_ token, expires_at=${tokenBody.expires_at ?? "unknown"}, ttl=${tokenBody.expires_in ?? ttl}s.`);

const tts = await new Promise<{ words: number; firstAudioMs: number | null }>((resolve, reject) => {
  const started = Date.now();
  let words = 0;
  let firstAudioMs: number | null = null;
  const socket = new WebSocket(`wss://api.smallest.ai/waves/v1/tts/live?api_key=${encodeURIComponent(tokenBody.access_token!)}`);
  const timer = setTimeout(() => {
    socket.close();
    reject(new Error("Timed out waiting for a word_timestamp frame."));
  }, 20_000);

  socket.on("open", () => {
    socket.send(
      JSON.stringify({
        text,
        voice_id: "meher",
        model: "lightning_v3.1_pro",
        sample_rate: 24000,
        word_timestamps: true,
      }),
    );
  });

  socket.on("message", (raw) => {
    const frame = JSON.parse(raw.toString()) as {
      status?: string;
      error?: { message?: string };
      data?: { id?: number; word?: string; start?: number; end?: number };
    };
    if (frame.status === "error") {
      clearTimeout(timer);
      reject(new Error(frame.error?.message || "TTS error"));
      socket.close();
      return;
    }
    if (frame.status === "chunk" && firstAudioMs === null) {
      firstAudioMs = Date.now() - started;
      console.log(`First audio chunk at ${firstAudioMs} ms.`);
    }
    if (frame.status === "word_timestamp" && frame.data) {
      words += 1;
      if (words <= 3) {
        console.log(
          `word_timestamp id=${frame.data.id} word=${JSON.stringify(frame.data.word)} start=${frame.data.start} end=${frame.data.end}`,
        );
      }
    }
    if (frame.status === "complete") {
      clearTimeout(timer);
      socket.close();
      resolve({ words, firstAudioMs });
    }
  });

  socket.on("error", (error) => {
    clearTimeout(timer);
    reject(error);
  });
});

if (tts.words < 1) {
  console.error("The socket closed without a word_timestamp frame.");
  process.exit(1);
}

const sttUrl = new URL("wss://api.smallest.ai/waves/v1/stt/live");
sttUrl.searchParams.set("model", "pulse");
sttUrl.searchParams.set("language", "en");
sttUrl.searchParams.set("encoding", "linear16");
sttUrl.searchParams.set("sample_rate", "16000");
sttUrl.searchParams.set("api_key", tokenBody.access_token);

await new Promise<void>((resolve, reject) => {
  const socket = new WebSocket(sttUrl);
  const timer = setTimeout(() => {
    socket.close();
    reject(new Error("Pulse socket timed out."));
  }, 10_000);
  socket.on("open", () => {
    console.log("Pulse streaming socket accepted model=pulse.");
    socket.send(JSON.stringify({ type: "close_stream" }));
  });
  socket.on("close", () => {
    clearTimeout(timer);
    resolve();
  });
  socket.on("error", (error) => {
    clearTimeout(timer);
    reject(error);
  });
});

console.log(`Live check passed. Word timestamps: ${tts.words}.`);
