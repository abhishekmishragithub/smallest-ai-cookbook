import { matchQuestion, PAGE_BRIEF, unknownAnswer } from "./catalog";
import { corsHeaders, isPreflightRejected, parseAllowlist } from "./cors";
import { json, rateHeaders } from "./http";
import { clientIp, type RateLimiter } from "./rate-limit";
import {
  narrateRequestSchema,
  narrateResponseSchema,
  type Cue,
  type NarrateResponse,
  type PageContext,
} from "./schemas";
import { sanitizeSelector, sanitizeSvg } from "./svg-sanitize";
import { splitWords } from "./words";

export type NarrateDeps = {
  env: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  limiter: RateLimiter;
};

const SYSTEM = [
  "You explain Smallest AI documentation out loud.",
  "Reply with one JSON object only: {\"narration\": string, \"cues\": array}.",
  "narration is plain spoken English. Do not use an em dash.",
  "cues items are {id, atWord, kind, svg?, target?, label?}.",
  "id is kebab-case: lowercase letters, digits, and hyphens only, like refund-policy.",
  "atWord is a 0-based index into narration split on whitespace.",
  "kind is diagram, highlight, or arrow.",
  "svg, when present, is a small standalone svg using only shapes and text.",
  "Use only facts that appear in the page text. Do not invent endpoints, parameters, or numbers.",
  "If the page text does not answer the question, say so in the narration and return one cue.",
].join(" ");

export async function handleNarrate(req: Request, deps: NarrateDeps): Promise<Response> {
  const allowlist = parseAllowlist(deps.env.ALLOWED_ORIGINS);
  const headers = corsHeaders(req, allowlist);
  if (isPreflightRejected(req, allowlist)) {
    return json({ error: "Origin is not allowed." }, 403, headers);
  }

  const limit = deps.limiter.check(`narrate:${clientIp(req)}`);
  const withRate = { ...headers, ...rateHeaders(limit) };
  if (!limit.ok) {
    return json({ error: "Too many narration requests. Wait and retry." }, 429, withRate);
  }

  const length = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > 100_000) {
    return json({ error: "Request is too large." }, 413, withRate);
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON." }, 400, withRate);
  }

  const parsed = narrateRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return json({ error: "Invalid request." }, 400, withRate);
  }

  const answer = await resolveNarration(parsed.data.question, parsed.data.page, deps);
  const safe = sanitizeNarration(answer);
  const checked = narrateResponseSchema.safeParse(safe);
  if (!checked.success) {
    return json({ error: "Narration could not be prepared." }, 500, withRate);
  }
  return json(checked.data, 200, withRate);
}

export async function resolveNarration(
  question: string,
  page: PageContext,
  deps: Pick<NarrateDeps, "env" | "fetchImpl">,
): Promise<NarrateResponse> {
  const known = matchQuestion(question);
  if (known) return known.answer;

  if (!deps.env.SMALLEST_API_KEY) return unknownAnswer();

  const generated = await narrateWithElectron(question, page, deps.env.SMALLEST_API_KEY, deps.fetchImpl);
  return generated ?? unknownAnswer();
}

export function sanitizeNarration(answer: NarrateResponse): NarrateResponse {
  const words = splitWords(answer.narration);
  const cues: Cue[] = [];
  for (const cue of answer.cues) {
    if (cue.atWord < 0 || cue.atWord >= words.length) continue;
    const svg = cue.svg ? sanitizeSvg(cue.svg) ?? undefined : undefined;
    if (cue.kind === "diagram" && cue.svg && !svg) continue;
    const target = sanitizeSelector(cue.target);
    cues.push({
      id: cue.id,
      atWord: cue.atWord,
      kind: cue.kind,
      ...(svg ? { svg } : {}),
      ...(target ? { target } : {}),
      ...(cue.label ? { label: cue.label } : {}),
    });
  }
  return { narration: answer.narration.trim(), cues };
}

async function narrateWithElectron(
  question: string,
  page: PageContext,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<NarrateResponse | null> {
  const pageText = page.text.trim() ? page.text : PAGE_BRIEF;
  let response: Response;
  try {
    response = await fetchImpl("https://api.smallest.ai/waves/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "electron",
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: JSON.stringify({
              question,
              page: { url: page.url, title: page.title, text: pageText },
            }),
          },
        ],
      }),
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string") return null;
  const raw = extractJson(content);
  const parsed = narrateResponseSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function extractJson(content: string): unknown {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(content.slice(start, end + 1));
  } catch {
    return null;
  }
}
