export type Phase =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "error"
  | "interrupted";

export type SessionState = {
  phase: Phase;
  question: string;
  partial: string;
  narration: string;
  caption: string;
  activeCueId: string | null;
  error: string | null;
};

export type SessionEvent =
  | { type: "listen" }
  | { type: "partial"; text: string }
  | { type: "submit"; question: string }
  | { type: "narration"; narration: string }
  | { type: "caption"; text: string; cueId: string | null }
  | { type: "done" }
  | { type: "stop" }
  | { type: "fail"; message: string }
  | { type: "reset" };

export const initialState: SessionState = {
  phase: "idle",
  question: "",
  partial: "",
  narration: "",
  caption: "",
  activeCueId: null,
  error: null,
};

const canSubmit: Phase[] = ["idle", "listening", "thinking", "speaking", "interrupted", "error"];
const canListen: Phase[] = ["idle", "listening", "speaking", "interrupted", "error"];

export function transition(state: SessionState, event: SessionEvent): SessionState {
  switch (event.type) {
    case "listen":
      if (!canListen.includes(state.phase)) return state;
      return { ...initialState, phase: "listening" };
    case "partial":
      if (state.phase !== "listening") return state;
      return { ...state, partial: event.text };
    case "submit": {
      const question = event.question.trim();
      if (!question || !canSubmit.includes(state.phase)) return state;
      return { ...initialState, phase: "thinking", question };
    }
    case "narration":
      if (state.phase !== "thinking") return state;
      return { ...state, phase: "speaking", narration: event.narration, caption: "" };
    case "caption":
      if (state.phase !== "speaking") return state;
      return { ...state, caption: event.text, activeCueId: event.cueId };
    case "done":
      if (state.phase !== "speaking") return state;
      return { ...state, phase: "idle" };
    case "stop":
      if (state.phase === "idle") return state;
      return { ...state, phase: "interrupted", partial: "", error: null };
    case "fail":
      return {
        ...state,
        phase: "error",
        error: event.message,
        partial: "",
      };
    case "reset":
      return { ...initialState };
    default:
      return state;
  }
}
