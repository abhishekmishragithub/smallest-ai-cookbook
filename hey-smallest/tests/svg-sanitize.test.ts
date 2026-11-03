import { describe, expect, it } from "vitest";
import { QUESTIONS } from "@/lib/catalog";
import { sanitizeSelector, sanitizeSvg } from "@/lib/svg-sanitize";

const dirty = `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">
  <script>alert(1)</script>
  <foreignObject><div onclick="alert(1)">x</div></foreignObject>
  <rect onclick="alert(1)" href="https://evil.test/a" />
  <a href="javascript:alert(1)">x</a>
  <use href="//cdn.evil.test/a.svg" />
  <use href="data:text/html,hi" />
  <use href="#hey-arrow-ok" />
  <path style="fill:url(https://evil.test/a)" d="M0 0" />
</svg>`;

describe("svg sanitizer", () => {
  it("strips scripts, foreignObject, event handlers, and external hrefs", () => {
    const clean = sanitizeSvg(dirty);
    expect(clean).toBeTruthy();
    expect(clean).not.toMatch(/script/i);
    expect(clean).not.toMatch(/foreignObject/i);
    expect(clean).not.toMatch(/\son[a-z]+=/i);
    expect(clean).not.toMatch(/href\s*=\s*["']https?:/i);
    expect(clean).not.toMatch(/javascript:/i);
    expect(clean).not.toMatch(/href\s*=\s*["']\/\//);
    expect(clean).not.toMatch(/data:/i);
    expect(clean).toContain('href="#hey-arrow-ok"');
    expect(clean?.startsWith("<svg")).toBe(true);
  });

  it("rejects a payload that is not an svg", () => {
    expect(sanitizeSvg("<div>nope</div>")).toBeNull();
    expect(sanitizeSvg("")).toBeNull();
  });

  it("keeps the demo diagrams as data", () => {
    for (const question of QUESTIONS) {
      for (const cue of question.answer.cues) {
        expect(cue.svg).toBeTruthy();
        const clean = sanitizeSvg(cue.svg ?? "");
        expect(clean).toContain("<svg");
        expect(clean).not.toMatch(/<script/i);
      }
    }
  });

  it("allows a simple docs selector and rejects urls", () => {
    expect(sanitizeSelector("main h1")).toBe("main h1");
    expect(sanitizeSelector("#setup")).toBe("#setup");
    expect(sanitizeSelector("a[href=https://evil.test]")).toBeUndefined();
    expect(sanitizeSelector("body:has(script)")).toBeUndefined();
  });
});
