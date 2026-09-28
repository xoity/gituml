import { compileDiagramGraph, validateDiagramGraph } from "./graph";
import { normalizeDiagramText } from "~/features/diagram/graph";
import type { UmlAnalysis, UmlDocument } from "~/features/diagram/uml";

/**
 * The excerpt a model is shown is not the raw file: `excerptSource` inserts
 * `[excerpt begins at line N; gaps omitted]` markers, a trailing
 * `[end of excerpts; unsampled lines omitted]`, and an
 * `[import bindings for calls below]` preamble. A model that quotes a line
 * together with its marker, or quotes one of those binding lines, is quoting
 * text it really was shown, so those two forms are accepted. Nothing else is:
 * the quote must still appear verbatim in the inspected material.
 */
const EXCERPT_MARKER =
  /^\[(?:excerpt begins at line \d+; gaps omitted|end of excerpts; unsampled lines omitted|import bindings for calls below)\]$/;

function quoteAppearsInSource(source: string, quote: string): boolean {
  if (source.includes(quote)) return true;

  const lines = quote.split("\n");
  if (lines.length < 2) return false;
  // Drop the excerpt's own marker lines, then require the remaining text to be
  // present exactly as written.
  const withoutMarkers = lines.filter(
    (line) => !EXCERPT_MARKER.test(line.trim()),
  );
  if (withoutMarkers.length === lines.length) return false;
  return withoutMarkers.every((line) => source.includes(line));
}

export function verifyUmlEvidence(
  evidence: { path: string; quote: string },
  sources: ReadonlyMap<string, string>,
): boolean {
  const source = sources.get(evidence.path);
  return Boolean(source && quoteAppearsInSource(source, evidence.quote));
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
  for (const detail of document.edgeDetails) {
    if (detail.index >= document.graph.edges.length) {
      throw new Error(
        `Relationship evidence points at edge ${detail.index}, which does not exist.`,
      );
    }
    if (!verifyUmlEvidence(detail.evidence, sources)) {
      const edge = document.graph.edges[detail.index]!;
      throw new Error(
        `The quote for the relationship "${edge.from} -> ${edge.to}" was not found in ${detail.evidence.path}. Quote the exact line that shows that relationship, or drop the relationship.`,
      );
    }
  }
  for (const member of [...document.members, ...document.intervals]) {
    if (!nodes.has(member.node)) {
      throw new Error(`Member evidence names unknown node "${member.node}".`);
    }
    if (!verifyUmlEvidence(member.evidence, sources)) {
      const label = "name" in member ? member.name : member.state;
      throw new Error(
        `The quote for "${label}" on node "${member.node}" was not found in ${member.evidence.path}. Quote that element's own declaration line exactly, or omit it.`,
      );
    }
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
    // Real state-machine notation: a start marker, composite states for the
    // groups the model declared, and labelled transitions. A node whose label
    // reads as a start/end pseudo-state becomes [*] rather than a box.
    const isPseudo = (label: string) =>
      /^(?:\[\*\]|start|initial|begin|end|final|done|stopped|terminated)$/i.test(
        label.trim(),
      );
    const lines = ["stateDiagram-v2", "direction TB"];
    const grouped = new Set<string>();
    for (const group of document.graph.groups) {
      const members = nodes.filter((node) => node.groupId === group.id);
      if (!members.length) continue;
      lines.push(`state "${text(group.label)}" as group_${group.id} {`);
      for (const node of members) {
        grouped.add(node.id);
        lines.push(
          isPseudo(node.label)
            ? `  state "${text(node.label)}" as ${nodeId(node.id)}`
            : `  ${nodeId(node.id)} : ${text(node.label)}`,
        );
      }
      lines.push("}");
    }
    for (const node of nodes) {
      if (grouped.has(node.id)) continue;
      lines.push(
        isPseudo(node.label)
          ? `state "${text(node.label)}" as ${nodeId(node.id)}`
          : `${nodeId(node.id)} : ${text(node.label)}`,
      );
    }
    // A start marker is only drawn when the model did not declare one, so an
    // explicit initial state is never duplicated.
    const hasStart = nodes.some((node) => isPseudo(node.label));
    if (!hasStart && nodes.length) {
      lines.push(`[*] --> ${nodeId(nodes[0]!.id)}`);
    }
    for (const edge of edges) {
      lines.push(
        `${nodeId(edge.from)} --> ${nodeId(edge.to)}${edge.label ? ` : ${text(edge.label)}` : ""}`,
      );
    }
    return lines.join("\n");
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
