# Mock audio for Hey Smallest demo mode
Rendered from `QUESTIONS[i].answer.narration` in src/lib/catalog.ts (and `unknownAnswer()` for unknown.*)
over wss://api.smallest.ai/waves/v1/tts/live, voice meher, lightning_v3.1_pro, sample_rate 24000, word_timestamps true.
mp3: mono 24 kHz 48 kbps. timestamps.json: raw word_timestamp frames as received, plus durationSec and narration.

| catalog id | question | files |
|---|---|---|
| call-flow | How does a voice agent call flow end to end? | call-flow.mp3 / .timestamps.json |
| lightning | How do I stream TTS with Lightning? | lightning.* |
| pulse | Pulse streaming vs batch STT? | pulse.* |
| phone | How do I connect Atoms to my phone number? | phone.* |
| clone | How do I add a custom voice or voice clone? | clone.* |
| latency | How does latency break down in a voice pipeline? | latency.* |
| integrations | How do I use Smallest with Pipecat or LiveKit? | integrations.* |
| auth | How do I authenticate and get an API key? | auth.* |
| (fallback) unknownAnswer() | any unmatched question | unknown.* |

Quirks: call-flow frame ids reset to 0 at server text chunks (ids 0-23, 0-29, 0-6); phone merges
"POST /atoms/v1/product/rent-number" into one frame (42 frames for 43 words). The scheduler's
nearest-word matching still fires every cue on the right word (simulated). latency has 5 compressed frames (best of 4 renders).
Regenerate: cd src/hey-smallest && npx tsx /workspace/hey-smallest/tools/render-mock-audio.mts
