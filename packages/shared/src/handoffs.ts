import { z } from "zod";

const handoffPrioritySchema = z.enum(["critical", "high", "medium", "low"]);
const handoffTypeSchema = z.enum([
  "work-request",
  "escalation",
  "information-request",
  "status-update",
]);
const handoffOutcomeSchema = z.enum(["done", "blocked"]);

const relatedArtifactSchema = z.object({
  type: z.string().trim().min(1),
  path: z.string().trim().min(1),
});

const handoffContextSchema = z.object({
  summary: z.string().trim().min(1),
  sourceIssueId: z.string().trim().min(1).nullable().optional(),
  relatedArtifacts: z.array(relatedArtifactSchema).optional().default([]),
});

const handoffResponseSchemaField = z.union([
  z.string().trim().min(1),
  z.array(z.string().trim().min(1)),
  z.record(z.unknown()),
]);

export const handoffRequestSchema = z.object({
  version: z.string().trim().min(1),
  from: z.string().trim().min(1),
  to: z.string().trim().min(1),
  type: handoffTypeSchema,
  priority: handoffPrioritySchema,
  context: handoffContextSchema,
  expectedOutcome: z.string().trim().min(1),
  deadline: z.string().datetime().optional(),
  responseSchema: z.record(handoffResponseSchemaField).optional().default({}),
});

export const handoffResponseSchema = z.object({
  version: z.string().trim().min(1),
  from: z.string().trim().min(1),
  to: z.string().trim().min(1),
  sourceHandoffIssueId: z.string().trim().min(1),
  outcome: handoffOutcomeSchema,
  result: z.record(z.unknown()).optional().default({}),
  proofLinks: z.array(z.string().trim().min(1)).optional().default([]),
  followUpNeeded: z.boolean().optional().default(false),
  followUpReason: z.string().trim().min(1).nullable().optional(),
});

export const handoffRequestEnvelopeSchema = z.object({
  handoff: handoffRequestSchema,
});

export const handoffResponseEnvelopeSchema = z.object({
  handoff_response: handoffResponseSchema,
});

export type HandoffPriority = z.infer<typeof handoffPrioritySchema>;
export type HandoffType = z.infer<typeof handoffTypeSchema>;
export type HandoffOutcome = z.infer<typeof handoffOutcomeSchema>;
export type HandoffRequest = z.infer<typeof handoffRequestSchema>;
export type HandoffResponse = z.infer<typeof handoffResponseSchema>;
export type HandoffRequestEnvelope = z.infer<typeof handoffRequestEnvelopeSchema>;
export type HandoffResponseEnvelope = z.infer<typeof handoffResponseEnvelopeSchema>;
export type ParsedHandoffComment =
  | { kind: "request"; envelope: HandoffRequestEnvelope }
  | { kind: "response"; envelope: HandoffResponseEnvelope };

function trimFencedJsonBlock(body: string): string | null {
  const match = body.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (!match || typeof match[1] !== "string") return null;
  const candidate = match[1].trim();
  return candidate.length > 0 ? candidate : null;
}

export function extractHandoffJsonCandidate(body: string): string | null {
  const trimmed = body.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }
  return trimFencedJsonBlock(trimmed);
}

export function parseHandoffComment(body: string): ParsedHandoffComment | null {
  const candidate = extractHandoffJsonCandidate(body);
  if (!candidate) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }

  const requestResult = handoffRequestEnvelopeSchema.safeParse(parsed);
  if (requestResult.success) {
    return { kind: "request", envelope: requestResult.data };
  }

  const responseResult = handoffResponseEnvelopeSchema.safeParse(parsed);
  if (responseResult.success) {
    return { kind: "response", envelope: responseResult.data };
  }

  return null;
}

export function validateHandoffComment(body: string, expectedKind?: ParsedHandoffComment["kind"]) {
  const candidate = extractHandoffJsonCandidate(body);
  if (!candidate) {
    return {
      ok: false as const,
      reason: "Structured handoff comments must contain a JSON object or fenced ```json``` block.",
      details: null,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (error) {
    return {
      ok: false as const,
      reason: "Structured handoff comments must contain valid JSON.",
      details: error instanceof Error ? error.message : String(error),
    };
  }

  if (expectedKind === "request") {
    const result = handoffRequestEnvelopeSchema.safeParse(parsed);
    return result.success
      ? { ok: true as const, parsed: { kind: "request" as const, envelope: result.data } }
      : {
        ok: false as const,
        reason: "The first handoff comment must match the handoff request schema.",
        details: result.error.flatten(),
      };
  }

  if (expectedKind === "response") {
    const result = handoffResponseEnvelopeSchema.safeParse(parsed);
    return result.success
      ? { ok: true as const, parsed: { kind: "response" as const, envelope: result.data } }
      : {
        ok: false as const,
        reason: "Handoff response comments must match the handoff response schema.",
        details: result.error.flatten(),
      };
  }

  const requestResult = handoffRequestEnvelopeSchema.safeParse(parsed);
  if (requestResult.success) {
    return { ok: true as const, parsed: { kind: "request" as const, envelope: requestResult.data } };
  }

  const responseResult = handoffResponseEnvelopeSchema.safeParse(parsed);
  if (responseResult.success) {
    return { ok: true as const, parsed: { kind: "response" as const, envelope: responseResult.data } };
  }

  return {
    ok: false as const,
    reason: "Structured handoff comments must match either the handoff request or handoff response schema.",
    details: {
      handoff: requestResult.error.flatten(),
      handoff_response: responseResult.error.flatten(),
    },
  };
}

export function isHandoffIssueTitle(title: string | null | undefined) {
  return /^\s*\[handoff\]/i.test(title ?? "");
}
