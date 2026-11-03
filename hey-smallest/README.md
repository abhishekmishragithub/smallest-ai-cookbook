# Hey Smallest

A voice and visuals explainer for the Smallest docs. Press Ask, speak a question, and Lightning narrates the answer while an SVG diagram steps forward on the word being spoken.

The demo runs with no API keys. Live mode uses Pulse for streaming speech to text and Lightning for streaming speech with word timestamps.

## Setup

From this directory:

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

With no `SMALLEST_API_KEY`, `POST /api/token` returns `mode: "mock"`. Narration comes from a grounded catalog. Mock mode plays a bundled Lightning recording of that answer (meher, `lightning_v3.1_pro`) from `public/mock-audio/`, and the cues follow that file's word timestamps on the audio clock. Synthetic timestamps and silence are only used if the recording fails to load. The microphone needs a real token, so mock mode asks you to type a question or pick a chip.

## Environment

| Name | Purpose |
| --- | --- |
| `SMALLEST_API_KEY` | Server only. Mints `wat_` tokens and calls Electron. Never sent to the browser. |
| `SMALLEST_ADMIN_API_KEY` | Not used by these routes. `POST /console/v1/auth/token` rejects admin keys. Listed so a host can add Atoms admin calls later. |
| `ALLOWED_ORIGINS` | Comma separated browser origins for `/api/token` and `/api/narrate`. Exact origins, or one wildcard label such as `https://*.docs.buildwithfern.com`. A bare `*` is ignored. |
| `NEXT_PUBLIC_MOCK_MS_PER_CHAR` | Character estimate used only when a voice emits no word timestamps, and as the silent fallback. Default `65`, near meher's pace. |

Default allowlist: `https://docs.smallest.ai` and `https://*.docs.buildwithfern.com`. A request whose `Origin` matches the app's own host is allowed too, so the demo page does not need to list itself.

## Scripts

```bash
npm test          # unit tests, including mock-mode cue order
npm run lint
npm run build
npm run test:e2e  # browser test that cues fire in order
npm run verify-live
```

`verify-live` is for a machine that has a real key. It mints a token (TTL 120 seconds), opens the Lightning WebSocket with `word_timestamps: true` on `meher` / `lightning_v3.1_pro`, prints the first word frames, and checks that a Pulse streaming socket accepts `model=pulse`. Pass a base URL to also POST `/api/narrate` and require a narration plus at least one cue.

```bash
SMALLEST_API_KEY=... npm run verify-live
SMALLEST_API_KEY=... npm run verify-live -- http://127.0.0.1:3000
```

`VERIFY_BASE_URL` is the same option when you do not want a positional argument.

## Vercel

Set the project root directory to `hey-smallest`. Framework is Next.js. Set `SMALLEST_API_KEY` and, if you embed the app on the docs site, `ALLOWED_ORIGINS`.

## Architecture

```text
button or Ctrl/Cmd K
  -> Pulse streaming STT (wss://api.smallest.ai/waves/v1/stt/live?model=pulse)
  -> POST /api/narrate { question, page }
  -> Lightning streaming TTS (wss://api.smallest.ai/waves/v1/tts/live, word_timestamps: true)
  -> CueScheduler releases each cue at that word's start
```

The browser never holds `SMALLEST_API_KEY`.

1. `POST /api/token` mints a token on the server with `POST https://api.smallest.ai/console/v1/auth/token` and `ttl_seconds: 300` (the platform allows 30 to 900; this app stays at or under 300). The response is `{ token, expires_at, mode }`. `token` is the `wat_` access token. Rate limited per IP. Without a key, `mode` is `"mock"` and `token` is null.
2. `POST /api/narrate` accepts `{ question, page: { url, title, text } }`. `page.text` is capped at 8000 characters. The response is `{ narration, cues, mockId? }`. Each cue is `{ id, atWord, kind, svg?, target?, label? }`. `atWord` is the 0-based index into `narration.split(/\s+/)`. `kind` is `diagram`, `highlight`, or `arrow`. `mockId` is the catalog id (`call-flow`, `lightning`, `pulse`, `phone`, `clone`, `latency`, `integrations`, `auth`, or `unknown`) when a bundled recording exists.
3. The eight demo questions resolve from a catalog grounded in the public docs (endpoints, fields, and latency figures that the docs publish). Any other question is sent to Electron (`POST /waves/v1/chat/completions`, `model: "electron"`) when a key is set. `wat_` tokens cannot call the LLM, so that call stays on the server.
4. SVG in a cue is data. The server strips `script`, `foreignObject`, event handler attributes, and hrefs that are not internal fragments. The client sanitizes again before inserting the markup.
5. Speech to text in the browser uses `model=pulse` (not `pulse-pro`, which is pre-recorded). Audio is 16 kHz PCM sent from a script processor. A blob URL worklet is avoided because the docs CSP is strict.
6. Text to speech sends `voice_id`, `text`, `model`, `sample_rate: 24000`, and `word_timestamps: true`. Word frames are `{ id, word, start, end }` in seconds. Cues stay at time 0 until the first audio buffer is scheduled, so the time to first byte does not run the character-count fallback. Frames are matched to narration words by normalized text in order, because some chunk boundaries restart `id` and some tokens are merged. A real word frame overrides the character estimate even if that estimate already started. The estimate itself uses 65 ms per character. The wall-clock give-up scales with the narration length.

Mock recordings live in `public/mock-audio/<mockId>.mp3` and `<mockId>.timestamps.json`. See `public/mock-audio/MAPPING.md`.

UI phases are `idle`, `listening`, `thinking`, `speaking`, `error`, and `interrupted`.

## Component

```tsx
import { HeySmallest } from "@/components/HeySmallest";

<HeySmallest
  endpoint=""
  voice="meher"
  model="lightning_v3.1_pro"
  pageContext={{
    url: "https://docs.smallest.ai/models/text-to-speech/streaming",
    title: "Streaming",
    text: "Visible text of the current docs page.",
  }}
/>
```

| Prop | Required | Default | Meaning |
| --- | --- | --- | --- |
| `endpoint` | yes | | Base URL of this Next app. `""` means the same origin. |
| `voice` | no | `meher` | Lightning `voice_id`. Word timestamps are emitted for `meher`, `devansh`, `kartik`, `maithili`, `liam`, and `avery` on `lightning_v3.1_pro`. Other voices still speak. Cues then use the character estimate. |
| `model` | no | `lightning_v3.1_pro` | Lightning model id sent on the TTS socket. |
| `pageContext` | no | scraped | `{ url, title, text }` passed to `/api/narrate`. When omitted, the component reads `document.title`, `location.href`, and the text of `main` (or `body`), capped at 8000 characters. |

Speech to text is always `model=pulse`. It is not a prop.

The standalone page in this app renders the same component and the same two routes. Suggested chips are the eight demo questions.

### Embedding on docs.smallest.ai

Fern serves the docs with `Permissions-Policy: microphone=(self)` and a strict-dynamic script policy, so the widget has to live in the page, not in a cross-origin iframe. Point `endpoint` at the deployed Hey Smallest origin and allow that origin's responses from `https://docs.smallest.ai` (and Fern preview hosts) via `ALLOWED_ORIGINS`.

Styles sit under `.hey-smallest` and read Fern's `--accent` and `--grayscale` when those variables exist:

- `--accent` becomes the button and active diagram color.
- `--grayscale` becomes the text color (`--hey-ink`).

The type stack is `"Aeonik Pro", Geist, system-ui`. Aeonik Pro is the design-system display face. This app ships Geist through `next/font` and falls back when Aeonik is not installed. No inline eval and no third-party script tags.

For a later shadow root, adopt `src/components/hey-smallest.css` (it imports the tokens) inside the shadow tree and render `<HeySmallest />` there. Selectors are prefixed, and the component does not require document-level ids. `pageContext` scraping still uses the light DOM `document`, which is what you want on a docs page.

## Accessibility

- Ask is a real `<button>` with `aria-pressed` and `aria-keyshortcuts`. Ctrl K or Command K starts or finishes a question. Escape stops.
- Stop is a separate control.
- A polite live region announces the latest spoken word. The visible caption is the words so far.
- `prefers-reduced-motion` removes the stage fade and the listening pulse.
- If the microphone is denied, or mock mode has no token, a text field and the question chips still ask.
- Focus styles use the accent color.

## Demo questions

1. How does a voice agent call flow end to end?
2. How do I stream TTS with Lightning?
3. Pulse streaming vs batch STT?
4. How do I connect Atoms to my phone number?
5. How do I add a custom voice or voice clone?
6. How does latency break down in a voice pipeline?
7. How do I use Smallest with Pipecat or LiveKit?
8. How do I authenticate and get an API key?

Narration uses documented routes and fields: Lightning `wss://api.smallest.ai/waves/v1/tts/live`, Pulse `model=pulse` versus batch `POST /waves/v1/stt/`, rent then `POST /atoms/v1/agent/{agentId}/answers`, `POST /waves/v1/voice-cloning`, and `POST /console/v1/auth/token`. Latency figures are the published in-region numbers (Pulse about 150 ms at one concurrency, Lightning about 200 ms), plus the docs note that a distant laptop often sees 500 to 800 ms.

## Tests

- State machine transitions.
- CueScheduler word timestamps and the character-count fallback.
- Punctuation tolerant `atWord` mapping.
- Token route: mock mode, TTL 300, per-IP limit, CORS.
- Narrate schema, page text cap, SVG sanitizer, Electron response cleanup.
- Mock-mode end to end: for each demo question, synthetic timestamps fire cues in `atWord` order.
