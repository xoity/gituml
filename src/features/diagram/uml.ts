import { z } from "zod";
import { diagramGraphSchema } from "./graph";

import { UML_TYPES } from "./uml-catalog";
export { UML_TYPES } from "./uml-catalog";

export const umlTypeSchema = z.enum(
  Object.keys(UML_TYPES) as [
    keyof typeof UML_TYPES,
    ...(keyof typeof UML_TYPES)[],
  ],
);
export type UmlType = z.infer<typeof umlTypeSchema>;

const evidenceSchema = z.object({
  path: z.string().min(1).max(512),
  quote: z.string().min(12).max(500),
});

export const umlAnalysisSchema = z.object({
  summary: z.string().min(1).max(1800),
  recommendations: z
    .array(
      z.object({
        type: umlTypeSchema,
        reason: z.string().min(1).max(500),
        evidence: z.array(evidenceSchema).min(1).max(4),
      }),
    )
    .max(18),
  limitations: z.array(z.string().max(500)).max(8),
});
export type UmlAnalysis = z.infer<typeof umlAnalysisSchema>;

const identifier = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/)
  .max(80);
export const umlDocumentSchema = z.object({
  type: umlTypeSchema,
  title: z.string().min(1).max(120),
  explanation: z.string().min(1).max(4000),
  graph: diagramGraphSchema,
  nodeEvidence: z
    .array(z.object({ node: identifier, evidence: evidenceSchema }))
    .min(1)
    .max(34),
  edgeDetails: z
    .array(
      z.object({
        index: z.number().int().min(0).max(47),
        relation: z.enum([
          "association",
          "dependency",
          "inheritance",
          "realization",
          "composition",
          "aggregation",
          "message",
          "return",
          "transition",
          "flow",
        ]),
        sourceCardinality: z.enum(["one", "zero-one", "many", "one-many"]),
        targetCardinality: z.enum(["one", "zero-one", "many", "one-many"]),
        evidence: evidenceSchema,
      }),
    )
    .max(48),
  members: z
    .array(
      z.object({
        node: identifier,
        name: z
          .string()
          .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
          .max(64),
        dataType: z
          .string()
          .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
          .max(64),
        kind: z.enum(["attribute", "method"]),
        key: z.enum(["PK", "FK", "UK"]).nullable(),
        evidence: evidenceSchema,
      }),
    )
    .max(80),
  intervals: z
    .array(
      z.object({
        node: identifier,
        state: z.string().min(1).max(72),
        startSeconds: z.number().int().min(0).max(86400),
        durationSeconds: z.number().int().min(1).max(86400),
        evidence: evidenceSchema,
      }),
    )
    .max(48),
});
export type UmlDocument = z.infer<typeof umlDocumentSchema>;
