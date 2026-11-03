import { z } from "zod";

export const PAGE_TEXT_MAX = 8000;

export const pageSchema = z.object({
  url: z.string().max(2000),
  title: z.string().max(300),
  text: z.string().max(PAGE_TEXT_MAX),
});

export const narrateRequestSchema = z.object({
  question: z.string().trim().min(1).max(500),
  page: pageSchema,
});

export const cueKindSchema = z.enum(["diagram", "highlight", "arrow"]);

/** Lowercase, and turn anything outside a-z, 0-9, and hyphen into a hyphen. */
export function normalizeCueId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-");
}

export const cueSchema = z.object({
  id: z
    .string()
    .transform(normalizeCueId)
    .pipe(z.string().min(1).max(64).regex(/^[a-z0-9-]+$/)),
  atWord: z.number().int().nonnegative(),
  kind: cueKindSchema,
  svg: z.string().max(30000).optional(),
  target: z.string().max(200).optional(),
  label: z.string().max(160).optional(),
});

export const narrateResponseSchema = z.object({
  narration: z.string().trim().min(1).max(4000),
  cues: z.array(cueSchema).max(16),
  /** Catalog id of the bundled mock recording, when this answer has one. */
  mockId: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .optional(),
});

export const tokenResponseSchema = z.object({
  token: z.string().min(1).nullable(),
  expires_at: z.string().nullable(),
  mode: z.enum(["live", "mock"]),
});

export type PageContext = z.infer<typeof pageSchema>;
export type NarrateRequest = z.infer<typeof narrateRequestSchema>;
export type Cue = z.infer<typeof cueSchema>;
export type CueKind = z.infer<typeof cueKindSchema>;
export type NarrateResponse = z.infer<typeof narrateResponseSchema>;

export const HEY_SMALLEST_DEFAULTS = {
  voice: "meher",
  model: "lightning_v3.1_pro",
  sttModel: "pulse",
  sampleRate: 24000,
  sttSampleRate: 16000,
} as const;

export const TIMESTAMP_VOICES = ["meher", "devansh", "kartik", "maithili", "liam", "avery"] as const;
