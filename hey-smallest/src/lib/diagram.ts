function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type SceneNode = {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  on?: boolean;
};

export type SceneLine = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  on?: boolean;
};

/** Inline SVG figure. `id` keeps marker ids stable across server and client. */
export function scene(id: string, nodes: SceneNode[], lines: SceneLine[], note: string): string {
  const markerId = `hey-arrow-${id.replace(/[^a-z0-9-]/g, "")}`;
  const marker = `<defs><marker id="${markerId}" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0 L7 3 L0 6 Z" fill="var(--hey-ink)"/></marker></defs>`;
  const lineSvg = lines
    .map((line) => {
      const stroke = line.on ? "var(--hey-accent)" : "var(--hey-ink)";
      const opacity = line.on ? "" : ` opacity="0.4"`;
      return `<line x1="${line.x1}" y1="${line.y1}" x2="${line.x2}" y2="${line.y2}" stroke="${stroke}" stroke-width="1.25" marker-end="url(#${markerId})"${opacity}/>`;
    })
    .join("");
  const nodeSvg = nodes.map((node) => box(node)).join("");
  const noteSvg = `<text x="28" y="334" fill="var(--hey-ink)" opacity="0.62" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12">${escapeXml(note)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" fill="none" aria-hidden="true">${marker}${lineSvg}${nodeSvg}${noteSvg}</svg>`;
}

function box(node: SceneNode): string {
  const stroke = node.on ? "var(--hey-accent)" : "var(--hey-ink)";
  const fill = node.on ? "var(--hey-accent-soft)" : "transparent";
  const width = node.on ? "1.75" : "1.25";
  const lines = node.label.split("\n");
  const text = lines
    .map((line, index) => {
      const dy = (index - (lines.length - 1) / 2) * 16;
      return `<text x="${node.x + node.w / 2}" y="${node.y + node.h / 2 + dy}" text-anchor="middle" dominant-baseline="middle" fill="var(--hey-ink)" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="13">${escapeXml(line)}</text>`;
    })
    .join("");
  return `<rect x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="12" stroke="${stroke}" stroke-width="${width}" fill="${fill}"/>${text}`;
}

export const EMPTY_STAGE_SVG = scene(
  "empty",
  [
    { x: 48, y: 140, w: 140, h: 56, label: "You" },
    { x: 250, y: 140, w: 140, h: 56, label: "Docs" },
    { x: 452, y: 140, w: 140, h: 56, label: "Voice" },
  ],
  [
    { x1: 188, y1: 168, x2: 242, y2: 168 },
    { x1: 390, y1: 168, x2: 444, y2: 168 },
  ],
  "Ask a question. The figure advances on the spoken word.",
);
