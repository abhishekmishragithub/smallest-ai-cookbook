"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { QUESTIONS } from "@/lib/catalog";
import { DEFAULT_MS_PER_CHAR } from "@/lib/cue-scheduler";
import { EMPTY_STAGE_SVG } from "@/lib/diagram";
import { HEY_SMALLEST_DEFAULTS, type Cue, type PageContext } from "@/lib/schemas";
import { initialState, transition } from "@/lib/state-machine";
import { sanitizeSvg } from "@/lib/svg-sanitize";
import { fetchNarration, fetchToken, playNarration, startMicrophone, type NarrationPayload } from "./playback";
import "./hey-smallest.css";

export type HeySmallestProps = {
  /** Base URL of this app. Use an empty string on the same origin. */
  endpoint: string;
  /** Lightning voice id. Defaults to meher, which emits word timestamps. */
  voice?: string;
  /** Lightning model id. Defaults to lightning_v3.1_pro. */
  model?: string;
  /** Page the question is about. When omitted, the component reads the document title, URL, and main text. */
  pageContext?: PageContext;
};

const STATUS: Record<string, string> = {
  idle: "Ready",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  error: "Something went wrong",
  interrupted: "Stopped",
};

export function HeySmallest({
  endpoint,
  voice = HEY_SMALLEST_DEFAULTS.voice,
  model = HEY_SMALLEST_DEFAULTS.model,
  pageContext,
}: HeySmallestProps) {
  const reduce = useReducedMotion();
  const [state, dispatch] = useReducer(transition, initialState);
  const [typed, setTyped] = useState("");
  const [story, setStory] = useState<NarrationPayload | null>(null);
  const [fired, setFired] = useState<string[]>([]);
  const [figure, setFigure] = useState(EMPTY_STAGE_SVG);
  const [figureLabel, setFigureLabel] = useState<string | null>(null);
  const [latestWord, setLatestWord] = useState("");
  const [mode, setMode] = useState<"live" | "mock" | "unknown">("unknown");
  const [micNote, setMicNote] = useState<string | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runRef = useRef(0);
  const pageRef = useRef<PageContext | null>(pageContext ?? null);
  const msPerChar = Number(process.env.NEXT_PUBLIC_MOCK_MS_PER_CHAR || String(DEFAULT_MS_PER_CHAR)) || DEFAULT_MS_PER_CHAR;

  useEffect(() => {
    pageRef.current = pageContext ?? scrapePage();
  }, [pageContext]);

  useEffect(() => {
    const controller = new AbortController();
    fetchToken(endpoint, controller.signal)
      .then((token) => setMode(token.token ? "live" : "mock"))
      .catch(() => undefined);
    return () => controller.abort();
  }, [endpoint]);

  const stop = useCallback(() => {
    runRef.current += 1;
    abortRef.current?.abort();
    dispatch({ type: "stop" });
  }, []);

  const ask = useCallback(
    async (question: string) => {
      const text = question.trim();
      if (!text) return;
      const run = ++runRef.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      dispatch({ type: "submit", question: text });
      setStory(null);
      setFired([]);
      setLatestWord("");
      setFigure(EMPTY_STAGE_SVG);
      setFigureLabel(null);
      setMicNote(null);
      try {
        const page = pageRef.current ?? scrapePage();
        const narration = await fetchNarration(endpoint, text, page, controller.signal);
        if (runRef.current !== run) return;
        setStory(narration);
        dispatch({ type: "narration", narration: narration.narration });
        const context = ensureAudio(audioRef);
        await context.resume();
        const played = await playNarration({
          endpoint,
          narration: narration.narration,
          cues: narration.cues,
          voice,
          model,
          context,
          signal: controller.signal,
          msPerChar,
          mockId: narration.mockId,
          onTick: (tick) => {
            if (runRef.current !== run) return;
            if (tick.caption) {
              dispatch({ type: "caption", text: tick.caption, cueId: tick.cueId });
            }
            if (tick.latestWord) setLatestWord(tick.latestWord);
            if (tick.cue) {
              setFired((current) => (current.includes(tick.cue!.id) ? current : [...current, tick.cue!.id]));
              if (tick.cue.svg) {
                const safe = sanitizeSvg(tick.cue.svg);
                if (safe) setFigure(safe);
              }
              if (tick.cue.label) setFigureLabel(tick.cue.label);
              if (tick.cue.target) flashTarget(tick.cue.target);
            }
          },
        });
        if (runRef.current !== run) return;
        setMode(played);
        dispatch({ type: "done" });
      } catch (error) {
        if (runRef.current !== run || isAbort(error)) return;
        dispatch({
          type: "fail",
          message: "The explanation did not finish. Try again in a moment.",
        });
      }
    },
    [endpoint, model, msPerChar, voice],
  );

  const listen = useCallback(async () => {
    if (state.phase === "listening") {
      abortRef.current?.abort();
      return;
    }
    const context = ensureAudio(audioRef);
    await context.resume();
    const run = ++runRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    dispatch({ type: "listen" });
    setMicNote(null);
    setLatestWord("");
    try {
      const token = await fetchToken(endpoint, controller.signal);
      if (runRef.current !== run) return;
      setMode(token.token ? "live" : "mock");
      if (!token.token) {
        dispatch({ type: "reset" });
        setMicNote("Microphone transcription needs an API key on the server. Type a question, or pick one below.");
        return;
      }
      const transcript = await startMicrophone({
        token: token.token,
        signal: controller.signal,
        onPartial: (partial) => {
          if (runRef.current === run) dispatch({ type: "partial", text: partial });
        },
      });
      if (runRef.current !== run) return;
      if (!transcript) {
        dispatch({ type: "fail", message: "I did not catch that. Type your question instead." });
        return;
      }
      await ask(transcript);
    } catch (error) {
      if (runRef.current !== run || isAbort(error)) return;
      if (isMicDenied(error)) {
        dispatch({ type: "reset" });
        setMicNote("Microphone access is blocked. Type your question instead.");
        return;
      }
      dispatch({ type: "fail", message: "Listening failed. Type your question instead." });
    }
  }, [ask, endpoint, state.phase]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const typing = Boolean(target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable));
      if (event.key === "Escape") {
        event.preventDefault();
        stop();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k" && !typing) {
        event.preventDefault();
        void listen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [listen, stop]);

  useEffect(() => {
    const active = abortRef;
    return () => {
      active.current?.abort();
    };
  }, []);

  const caption = state.phase === "listening" ? state.partial : state.caption;
  const activeId = state.activeCueId;
  const status = state.phase === "idle" && mode === "mock" ? "Mock mode" : STATUS[state.phase];

  return (
    <section
      className="hey-smallest"
      data-state={state.phase}
      data-mode={mode}
      data-cue-id={activeId ?? ""}
      aria-labelledby="hey-smallest-title"
    >
      <header>
        <p className="hey-mark">
          <strong>Smallest</strong> Hey
        </p>
        <h1 id="hey-smallest-title" className="hey-title">
          Ask the docs
        </h1>
        <p className="hey-lede">
          Speak a question about Smallest. Lightning narrates the answer, and the diagram moves when that word is spoken.
        </p>
      </header>

      <div className="hey-stage">
        {figureLabel ? <p className="hey-stage-label">{figureLabel}</p> : null}
        <AnimatePresence mode="popLayout">
          <motion.div
            className="hey-figure"
            key={activeId ?? "empty"}
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduce ? { opacity: 1 } : { opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.15, ease: "easeOut" }}
            dangerouslySetInnerHTML={{ __html: figure }}
          />
        </AnimatePresence>
      </div>

      <p className="hey-caption">{caption}</p>
      <span className="hey-sr" aria-live="polite">
        {state.phase === "speaking" ? latestWord : state.partial}
      </span>

      {story && story.cues.length > 0 ? (
        <ol className="hey-steps">
          {story.cues.map((cue) => {
            const step = cue.id === activeId ? "active" : fired.includes(cue.id) ? "done" : "idle";
            return (
              <li key={cue.id} data-step={step} data-cue-id={cue.id}>
                {cue.label ?? cue.id}
              </li>
            );
          })}
        </ol>
      ) : null}

      <div className="hey-controls">
        <button
          type="button"
          className="hey-ask"
          data-listening={state.phase === "listening" ? "true" : "false"}
          aria-pressed={state.phase === "listening"}
          aria-keyshortcuts="Control+K Meta+K"
          onClick={() => void listen()}
        >
          <MicIcon />
          {state.phase === "listening" ? "Done" : "Ask"}
          <kbd>⌘K</kbd>
        </button>
        <button type="button" className="hey-stop" onClick={stop} disabled={state.phase === "idle"}>
          Stop
        </button>
        <form
          className="hey-type"
          onSubmit={(event) => {
            event.preventDefault();
            void ask(typed);
            setTyped("");
          }}
        >
          <label htmlFor="hey-smallest-question">Type a question</label>
          <input
            id="hey-smallest-question"
            value={typed}
            placeholder="Type a question"
            autoComplete="off"
            onChange={(event) => setTyped(event.target.value)}
          />
          <button type="submit" className="hey-send">
            Send
          </button>
        </form>
      </div>

      {state.phase === "error" && state.error ? (
        <p className="hey-alert" role="alert">
          {state.error}
        </p>
      ) : null}
      {micNote ? <p className="hey-alert">{micNote}</p> : null}
      <p className="hey-status" role="status">
        {status}
        {state.question && state.phase !== "idle" ? ` · ${state.question}` : ""}
      </p>

      <ul className="hey-chips">
        {QUESTIONS.map((item) => (
          <li key={item.id}>
            <button type="button" className="hey-chip" onClick={() => void ask(item.question)} disabled={state.phase === "listening"}>
              {item.question}
            </button>
          </li>
        ))}
      </ul>
      <p className="hey-hint">
        Shortcut <kbd>Ctrl</kbd> <kbd>K</kbd> or <kbd>⌘</kbd> <kbd>K</kbd>. Escape stops. Speech to text uses Pulse.
      </p>
    </section>
  );
}

function MicIcon() {
  return (
    <svg className="hey-mic" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="6" y="1.5" width="4" height="8" rx="2" fill="currentColor" />
      <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 12 v2.2" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function ensureAudio(ref: { current: AudioContext | null }): AudioContext {
  if (!ref.current || ref.current.state === "closed") {
    ref.current = new AudioContext();
  }
  return ref.current;
}

function scrapePage(): PageContext {
  if (typeof document === "undefined") {
    return { url: "", title: "", text: "" };
  }
  const root = document.querySelector("main") ?? document.body;
  const text = (root?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 8000);
  return { url: window.location.href, title: document.title, text };
}

function flashTarget(selector: string) {
  let nodes: NodeListOf<Element>;
  try {
    nodes = document.querySelectorAll(selector);
  } catch {
    return;
  }
  nodes.forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    const previous = node.style.outline;
    const offset = node.style.outlineOffset;
    node.style.outline = "2px solid var(--accent, #0e6b5c)";
    node.style.outlineOffset = "4px";
    window.setTimeout(() => {
      node.style.outline = previous;
      node.style.outlineOffset = offset;
    }, 1400);
  });
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isMicDenied(error: unknown): boolean {
  return error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "NotFoundError" || error.name === "SecurityError");
}

export type { Cue };
