import { describe, expect, it } from "vitest";
import { initialState, transition } from "@/lib/state-machine";

describe("session state machine", () => {
  it("walks idle, listening, thinking, speaking, and back to idle", () => {
    let state = transition(initialState, { type: "listen" });
    expect(state.phase).toBe("listening");
    state = transition(state, { type: "partial", text: "how does" });
    expect(state.partial).toBe("how does");
    state = transition(state, { type: "submit", question: "How does a voice agent call flow end to end?" });
    expect(state.phase).toBe("thinking");
    expect(state.partial).toBe("");
    state = transition(state, { type: "narration", narration: "A voice agent call starts." });
    expect(state.phase).toBe("speaking");
    state = transition(state, { type: "caption", text: "A voice", cueId: "call-server" });
    expect(state.caption).toBe("A voice");
    expect(state.activeCueId).toBe("call-server");
    state = transition(state, { type: "done" });
    expect(state.phase).toBe("idle");
    expect(state.activeCueId).toBe("call-server");
  });

  it("stops from speaking into interrupted and can start again", () => {
    let state = transition(initialState, { type: "submit", question: "Latency" });
    state = transition(state, { type: "narration", narration: "Latency is a stack." });
    state = transition(state, { type: "stop" });
    expect(state.phase).toBe("interrupted");
    state = transition(state, { type: "listen" });
    expect(state.phase).toBe("listening");
    expect(state.narration).toBe("");
  });

  it("records an error and accepts a typed retry", () => {
    let state = transition(initialState, { type: "fail", message: "Microphone access is blocked. Type your question instead." });
    expect(state.phase).toBe("error");
    expect(state.error).toMatch(/Type your question/);
    state = transition(state, { type: "submit", question: "How do I authenticate and get an API key?" });
    expect(state.phase).toBe("thinking");
    expect(state.error).toBeNull();
  });

  it("ignores partials and captions outside their phases", () => {
    expect(transition(initialState, { type: "partial", text: "nope" }).phase).toBe("idle");
    expect(transition(initialState, { type: "caption", text: "nope", cueId: null }).phase).toBe("idle");
    expect(transition(initialState, { type: "stop" })).toEqual(initialState);
    expect(transition(initialState, { type: "submit", question: "   " }).phase).toBe("idle");
  });

  it("resets to idle", () => {
    const errored = transition(initialState, { type: "fail", message: "nope" });
    expect(transition(errored, { type: "reset" })).toEqual(initialState);
  });
});
