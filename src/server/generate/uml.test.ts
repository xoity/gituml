import { describe, expect, it } from "vitest";
import {
  compileUmlDocument,
  validateUmlDocument,
  verifyUmlEvidence,
} from "./uml";
import type { UmlDocument } from "~/features/diagram/uml";
import { normalizeGenerationUsage } from "./pricing";
import { validateMermaidSyntax } from "./mermaid";
import { UML_TYPES, type UmlType } from "~/features/diagram/uml";

const evidence = { path: "src/app.ts", quote: "class App extends Base" };
const document: UmlDocument = {
  type: "class",
  title: "App",
  explanation: "App inherits Base.",
  graph: {
    groups: [],
    nodes: ["app", "base"].map((id) => ({
      id,
      label: id,
      type: "class",
      description: null,
      groupId: null,
      path: evidence.path,
      shape: "box",
    })),
    edges: [
      {
        from: "app",
        to: "base",
        label: "inherits",
        description: null,
        style: null,
      },
    ],
  },
  nodeEvidence: ["app", "base"].map((node) => ({ node, evidence })),
  edgeDetails: [
    {
      index: 0,
      relation: "inheritance",
      sourceCardinality: "one",
      targetCardinality: "many",
      evidence,
    },
  ],
  members: [
    {
      node: "app",
      name: "id",
      dataType: "int",
      kind: "attribute",
      key: "PK",
      evidence,
    },
  ],
  intervals: [],
};
const repository = { username: "owner", repo: "repo", branch: "main" };

describe("UML compiler", () => {
  it("compiles every supported type into parseable Mermaid", async () => {
    for (const type of Object.keys(UML_TYPES) as UmlType[]) {
      const compiled = compileUmlDocument(
        {
          ...document,
          type,
          intervals: [
            {
              node: "app",
              state: "running",
              startSeconds: 0,
              durationSeconds: 10,
              evidence,
            },
          ],
        },
        repository,
      );
      const result = await validateMermaidSyntax(compiled);
      expect(
        result,
        `${type}: ${JSON.stringify(result)}\n${compiled}`,
      ).toMatchObject({ valid: true });
    }
  });
  it("accounts for Chat Completions token usage", () => {
    expect(
      normalizeGenerationUsage({
        prompt_tokens: 100,
        completion_tokens: 40,
        total_tokens: 140,
      }),
    ).toMatchObject({ inputTokens: 100, outputTokens: 40, totalTokens: 140 });
  });
  it("uses native notation and preserves relationship semantics", () => {
    expect(compileUmlDocument(document, repository)).toContain(
      "node_app --|> node_base",
    );
    expect(
      compileUmlDocument({ ...document, type: "sequence" }, repository),
    ).toContain("node_app->>node_base: inherits");
    expect(
      compileUmlDocument({ ...document, type: "state" }, repository),
    ).toContain("stateDiagram-v2");
    expect(
      compileUmlDocument({ ...document, type: "er" }, repository),
    ).toContain("node_app ||--o{ node_base");
  });
  it("requires evidence from inspected files for every edge", () => {
    const sources = new Map([[evidence.path, evidence.quote]]);
    expect(() =>
      validateUmlDocument(document, new Set(sources.keys()), sources),
    ).not.toThrow();
    expect(() =>
      validateUmlDocument(
        { ...document, edgeDetails: [] },
        new Set(sources.keys()),
        sources,
      ),
    ).toThrow("Every relationship");
    expect(verifyUmlEvidence({ ...evidence, path: "unread.ts" }, sources)).toBe(
      false,
    );
    expect(
      verifyUmlEvidence(
        { ...evidence, quote: "invented relationship" },
        sources,
      ),
    ).toBe(false);
  });
  it("escapes labels instead of accepting executable Mermaid", () => {
    const hostile = {
      ...document,
      graph: {
        ...document.graph,
        nodes: document.graph.nodes.map((node) => ({
          ...node,
          label: '\"; click app javascript:alert(1)\n%%{init: {}}%%',
        })),
      },
    };
    const compiled = compileUmlDocument(hostile, repository);
    expect(compiled).not.toContain('"; click');
    expect(compiled).not.toContain("%%{init");
  });
});
