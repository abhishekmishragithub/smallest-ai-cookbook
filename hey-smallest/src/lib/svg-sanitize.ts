const BLOCK =
  /<\s*(script|foreignObject|iframe|object|embed|audio|video|link|meta|style|image)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;
const BLOCK_VOID =
  /<\s*(script|foreignObject|iframe|object|embed|audio|video|link|meta|style|image)\b[^>]*\/?\s*>/gi;

const EVENT_ATTR = /\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const URL_ATTR =
  /\s+(?:href|xlink:href|src|srcset|poster|action)\s*=\s*("([^"]*)"|'([^']*)')/gi;
const STYLE_ATTR = /\s+style\s*=\s*("([^"]*)"|'([^']*)')/gi;

/**
 * Keep SVG as data. Drops scripts, foreignObject, event handlers, and any
 * href or src that is not an internal fragment.
 */
export function sanitizeSvg(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let svg = trimmed.replace(/<!--[\s\S]*?-->/g, "");
  svg = svg.replace(BLOCK, "");
  svg = svg.replace(BLOCK_VOID, "");
  svg = svg.replace(/<\/?\s*[a-zA-Z][^>]*>/g, (tag) => sanitizeTag(tag));

  const compact = svg.trim();
  if (!/^<svg\b/i.test(compact)) return null;
  if (/<\s*(script|foreignObject|iframe|object|embed)\b/i.test(compact)) return null;
  if (/\son[a-z]+\s*=/i.test(compact)) return null;
  return compact;
}

function sanitizeTag(tag: string): string {
  const name = tag.match(/^<\/?\s*([a-zA-Z0-9:-]+)/)?.[1]?.toLowerCase() ?? "";
  if (
    ["script", "foreignobject", "iframe", "object", "embed", "audio", "video", "link", "meta", "style", "image"].includes(
      name,
    )
  ) {
    return "";
  }

  let next = tag.replace(EVENT_ATTR, "");
  next = next.replace(URL_ATTR, (full, _quoted: string, doubleQuoted?: string, singleQuoted?: string) => {
    const value = (doubleQuoted ?? singleQuoted ?? "").trim();
    if (isInternalRef(value)) return full;
    return "";
  });
  next = next.replace(STYLE_ATTR, (full, _quoted: string, doubleQuoted?: string, singleQuoted?: string) => {
    const value = doubleQuoted ?? singleQuoted ?? "";
    if (/url\s*\(|expression\s*\(|javascript:|@import/i.test(value)) return "";
    return full;
  });
  return next;
}

function isInternalRef(value: string): boolean {
  if (!value.startsWith("#")) return false;
  if (value.startsWith("#//") || value.startsWith("#/")) return false;
  return /^#[A-Za-z][\w:.-]*$/.test(value);
}

const SAFE_SELECTOR = /^[a-zA-Z][\w-]*(\s+[a-zA-Z][\w-]*)*$|^#[A-Za-z][\w-]*$|^\.[A-Za-z][\w-]*$/;

/** CSS selectors used to point at a docs element. No functions, urls, or markup. */
export function sanitizeSelector(target: string | undefined): string | undefined {
  if (!target) return undefined;
  const value = target.trim();
  if (!value || value.length > 200) return undefined;
  if (/[()<>"'\\]|url|javascript|expression/i.test(value)) return undefined;
  if (!SAFE_SELECTOR.test(value)) return undefined;
  return value;
}
