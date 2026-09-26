import { compileDiagramGraph, validateDiagramGraph } from "./graph";
import { normalizeDiagramText } from "~/features/diagram/graph";
import type { UmlAnalysis, UmlDocument } from "~/features/diagram/uml";

export function verifyUmlEvidence(
  evidence: { path: string; quote: string },
  sources: ReadonlyMap<string, string>,
): boolean {
  const source = sources.get(evidence.path);
  return Boolean(source && source.includes(evidence.quote));
}

export function validateUmlAnalysis(
  analysis: UmlAnalysis,
  sources: ReadonlyMap<string, string>,
): void {
  const types = new Set<string>();
  for (const recommendation of analysis.recommendations) {
    if (types.has(recommendation.type))
      throw new Error("Duplicate diagram recommendation.");
    types.add(recommendation.type);
    if (
      !recommendation.evidence.every((entry) =>
        verifyUmlEvidence(entry, sources),
      )
    ) {
      throw new Error(
        "Recommendation references evidence that was not inspected.",
      );
    }
  }
}

export function validateUmlDocument(
  document: UmlDocument,
  paths: Set<string>,
  sources: ReadonlyMap<string, string>,
): void {
  const validation = validateDiagramGraph(document.graph, paths);
  if (!validation.valid) throw new Error(JSON.stringify(validation.issues));
  const nodes = new Set(document.graph.nodes.map((node) => node.id));
  const evidenced = new Set(document.nodeEvidence.map((entry) => entry.node));
  if (
    evidenced.size !== nodes.size ||
    [...nodes].some((node) => !evidenced.has(node))
  )
    throw new Error("Every node requires source evidence.");
  if (
    document.nodeEvidence.some(
      (entry) =>
        !nodes.has(entry.node) || !verifyUmlEvidence(entry.evidence, sources),
    )
  )
    throw new Error("Invalid node evidence.");
  const edges = new Set(document.edgeDetails.map((edge) => edge.index));
  if (
    edges.size !== document.graph.edges.length ||
    document.edgeDetails.length !== edges.size
  )
    throw new Error("Every relationship requires exactly one evidence record.");
  if (
    document.edgeDetails.some(
      (edge) =>
        edge.index >= document.graph.edges.length ||
        !verifyUmlEvidence(edge.evidence, sources),
    )
  )
    throw new Error("Invalid relationship evidence.");
  for (const member of [...document.members, ...document.intervals]) {
    if (!nodes.has(member.node) || !verifyUmlEvidence(member.evidence, sources))
      throw new Error("Invalid member or timing evidence.");
  }
  if (document.type === "timing" && !document.intervals.length)
    throw new Error("Timing diagrams require evidenced durations.");
  if (document.type === "er" && !document.members.length)
    throw new Error("ER diagrams require evidenced entity attributes.");
}

function text(value: string): string {
  return normalizeDiagramText(value).replace(
    /[&<>"'`#;:{}()[\]\\|%]/gu,
    (character) => `#${character.codePointAt(0)};`,
  );
}

export function compileUmlDocument(
  document: UmlDocument,
  repository: { username: string; repo: string; branch: string },
): string {
  const { nodes, edges } = document.graph;
  const nodeId = (id: string) => `node_${id}`;
  const details = new Map(
    document.edgeDetails.map((edge) => [edge.index, edge]),
  );
  if (document.type === "sequence") {
    return [
      "sequenceDiagram",
      "autonumber",
      ...nodes.map(
        (node) => `participant ${nodeId(node.id)} as ${text(node.label)}`,
      ),
      ...edges.map(
        (edge, index) =>
          `${nodeId(edge.from)}${details.get(index)?.relation === "return" ? "-->>" : "->>"}${nodeId(edge.to)}: ${text(edge.label ?? "calls")}`,
      ),
    ].join("\n");
  }
  if (document.type === "class" || document.type === "object") {
    const connectors = {
      association: "-->",
      dependency: "..>",
      inheritance: "--|>",
      realization: "..|>",
      composition: "*--",
      aggregation: "o--",
      message: "-->",
      return: "..>",
      transition: "-->",
      flow: "-->",
    } as const;
    return [
      "classDiagram",
      "direction TB",
      ...nodes.flatMap((node) => [
        `class ${nodeId(node.id)}["${text(node.label)}"]`,
        ...(document.type === "object"
          ? [`<<instance>> ${nodeId(node.id)}`]
          : []),
        ...document.members
          .filter((member) => member.node === node.id)
          .map(
            (member) =>
              `${nodeId(node.id)} : +${member.dataType} ${member.name}${member.kind === "method" ? "()" : ""}`,
          ),
      ]),
      ...edges.map(
        (edge, index) =>
          `${nodeId(edge.from)} ${connectors[details.get(index)?.relation ?? "association"]} ${nodeId(edge.to)}${edge.label ? ` : ${text(edge.label)}` : ""}`,
      ),
    ].join("\n");
  }
  if (document.type === "state") {
    return [
      "stateDiagram-v2",
      "direction TB",
      ...nodes.map(
        (node) => `state "${text(node.label)}" as ${nodeId(node.id)}`,
      ),
      ...edges.map(
        (edge) =>
          `${nodeId(edge.from)} --> ${nodeId(edge.to)}${edge.label ? ` : ${text(edge.label)}` : ""}`,
      ),
    ].join("\n");
  }
  if (document.type === "er") {
    const left = { one: "||", "zero-one": "|o", many: "}o", "one-many": "}|" };
    const right = { one: "||", "zero-one": "o|", many: "o{", "one-many": "|{" };
    return [
      "erDiagram",
      "direction TB",
      ...nodes.flatMap((node) => [
        `${nodeId(node.id)}["${text(node.label)}"] {`,
        ...document.members
          .filter((member) => member.node === node.id)
          .map(
            (member) =>
              `  ${member.dataType} ${member.name}${member.key ? ` ${member.key}` : ""}`,
          ),
        "}",
      ]),
      ...edges.map(
        (edge, index) =>
          `${nodeId(edge.from)} ${left[details.get(index)?.sourceCardinality ?? "one"]}--${right[details.get(index)?.targetCardinality ?? "many"]} ${nodeId(edge.to)} : "${text(edge.label ?? "relates to")}"`,
      ),
    ].join("\n");
  }
  if (document.type === "c4-context" || document.type === "c4-container") {
    return [
      document.type === "c4-context" ? "C4Context" : "C4Container",
      ...nodes.map((node) => {
        const kind = /actor|person|user/i.test(node.type)
          ? "Person"
          : document.type === "c4-context"
            ? "System"
            : node.shape === "database"
              ? "ContainerDb"
              : "Container";
        return `${kind}(${nodeId(node.id)}, "${text(node.label)}", "${text(node.type)}"${kind.startsWith("Container") ? `, "${text(node.description ?? node.label)}"` : ""})`;
      }),
      ...edges.map(
        (edge) =>
          `Rel(${nodeId(edge.from)}, ${nodeId(edge.to)}, "${text(edge.label ?? "uses")}")`,
      ),
    ].join("\n");
  }
  if (document.type === "timing") {
    return [
      "gantt",
      "dateFormat X",
      "axisFormat %H:%M:%S",
      ...nodes.flatMap((node) => [
        `section ${text(node.label)}`,
        ...document.intervals
          .filter((interval) => interval.node === node.id)
          .map(
            (interval, index) =>
              `${text(interval.state)} :${nodeId(node.id)}_${index}, ${interval.startSeconds}, ${interval.durationSeconds}s`,
          ),
      ]),
    ].join("\n");
  }
  const graph =
    document.type === "communication"
      ? {
          ...document.graph,
          edges: edges.map((edge, index) => ({
            ...edge,
            label: `${index + 1}. ${edge.label ?? "message"}`,
          })),
        }
      : document.graph;
  return compileDiagramGraph({ graph, ...repository });
}
