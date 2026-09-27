"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  CircleAlert,
  ExternalLink,
  Play,
  RefreshCw,
  Square,
} from "lucide-react";
import { GitHubIcon } from "~/components/icons/github-icon";
import { UML_NOTATION, UML_TYPES } from "~/features/diagram/uml-catalog";
import type { UmlAnalysis, UmlType } from "~/features/diagram/uml";
import type { DiagramStreamState } from "~/features/diagram/types";
import { ActivityMark } from "~/components/generation/activity-mark";
import { RepositoryWorkspace } from "~/components/generation/repository-workspace";
import { Toaster } from "~/components/ui/sonner";
import { TooltipProvider } from "~/components/ui/tooltip";
import styles from "~/components/generation/workspace.module.css";

interface ProgressStep {
  stage: string;
  message: string;
}

interface ServerEvent {
  stage?: string;
  message?: string;
  result?: unknown;
  error?: string;
}

/**
 * Reads the progress stream. Stage events are reported as they arrive so the
 * panel can show where the run is; the terminal event is returned.
 */
async function readProgress(
  response: Response,
  onStep: (step: ProgressStep) => void,
): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Generation failed unexpectedly. Please retry.");
  }
  const decoder = new TextDecoder();
  let buffer = "";
  let result: unknown;
  let failure: string | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const line = frame.split("\n").find((part) => part.startsWith("data: "));
      if (line) {
        const event = JSON.parse(line.slice(6)) as ServerEvent;
        if (event.error) failure = event.error;
        else if (event.result !== undefined) result = event.result;
        else if (event.stage && event.message) {
          onStep({ stage: event.stage, message: event.message });
        }
      }
      boundary = buffer.indexOf("\n\n");
    }
  }

  if (failure) throw new Error(failure);
  if (result === undefined) {
    throw new Error("Generation failed unexpectedly. Please retry.");
  }
  return result;
}

/**
 * Validates the streamed payload against the same schemas the server used, so
 * the client never renders something the server did not verify.
 */
async function parseResult(payload: unknown, type: UmlType | undefined) {
  const [{ z }, { umlAnalysisSchema, umlDocumentSchema }] = await Promise.all([
    import("zod"),
    import("~/features/diagram/uml"),
  ]);
  const warning = z.object({ persistenceWarning: z.string().optional() });

  if (!type) {
    return z
      .object({
        analysis: umlAnalysisSchema,
        branch: z.string(),
        sourcePaths: z.array(z.string()),
      })
      .and(warning)
      .parse(payload);
  }

  return z
    .object({
      document: umlDocumentSchema,
      diagram: z.string().min(1).max(100_000),
    })
    .and(warning)
    .parse(payload);
}

export function UmlWorkspace({
  username,
  repo,
}: {
  username: string;
  repo: string;
}) {
  const repository = `${username}/${repo}`;
  const [analysis, setAnalysis] = useState<UmlAnalysis | null>(null);
  const [selected, setSelected] = useState<UmlType | "">("");
  const [activeType, setActiveType] = useState<UmlType | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [steps, setSteps] = useState<ProgressStep[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [state, setState] = useState<DiagramStreamState>({ status: "idle" });
  const [lastGenerated, setLastGenerated] = useState<Date>();
  const [branch, setBranch] = useState("main");
  const controller = useRef<AbortController | null>(null);
  const results = useRef(
    new Map<UmlType, { state: DiagramStreamState; date: Date }>(),
  );

  const run = useCallback(
    async (requested?: UmlType, refresh = false) => {
      controller.current?.abort();
      const current = new AbortController();
      controller.current = current;
      setBusy(true);
      setError("");
      setSteps([]);
      setElapsed(0);
      if (requested) {
        setActiveType(requested);
        setState({ status: "started", startedAt: Date.now() });
      }

      try {
        const response = await fetch("/api/uml", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username,
            repo,
            ...(requested ? { type: requested } : {}),
            refresh,
          }),
          signal: current.signal,
        });

        const contentType = response.headers.get("content-type") ?? "";
        if (!contentType.includes("text/event-stream")) {
          const payload: unknown = await response.json().catch(() => null);
          const { z } = await import("zod");
          const failure = z.object({ error: z.string() }).safeParse(payload);
          throw new Error(
            failure.success
              ? failure.data.error
              : "Generation failed. Please retry.",
          );
        }

        const payload = await readProgress(response, (step) => {
          if (controller.current !== current) return;
          setSteps((existing) => [...existing.slice(-6), step]);
          if (requested) {
            setState((previous) => ({
              ...previous,
              status: "started",
              message: step.message,
            }));
          }
        });
        if (controller.current !== current) return;

        const result = await parseResult(payload, requested);
        const warning = result.persistenceWarning;

        if (requested) {
          const generated = result as {
            diagram: string;
            document: {
              explanation: string;
              graph: DiagramStreamState["graph"];
            };
          };
          const next: DiagramStreamState = {
            status: "complete",
            diagram: generated.diagram,
            explanation: generated.document.explanation,
            graph: generated.document.graph,
            persistenceWarning: warning,
          };
          const date = new Date();
          results.current.set(requested, { state: next, date });
          setState(next);
          setLastGenerated(date);
        } else {
          const next = result as {
            analysis: UmlAnalysis;
            branch: string;
          };
          setAnalysis(next.analysis);
          setBranch(next.branch);
          setSelected(next.analysis.recommendations[0]?.type ?? "");
          results.current.clear();
          setActiveType("");
          setState({ status: "idle", persistenceWarning: warning });
        }
      } catch (failure) {
        if (controller.current !== current) return;
        const message =
          current.signal.aborted || failure instanceof DOMException
            ? "Generation stopped."
            : failure instanceof Error
              ? failure.message
              : "Generation failed. Please retry.";
        setError(message);
        if (requested) setState({ status: "error", error: message });
      } finally {
        if (controller.current === current) setBusy(false);
      }
    },
    [repo, username],
  );

  // Analysis starts as soon as a repository page opens: the visitor chose the
  // repository by navigating here, so asking again would be a second decision.
  useEffect(() => {
    void run();
  }, [run]);

  useEffect(() => () => controller.current?.abort(), []);

  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setElapsed((value) => value + 1), 1_000);
    return () => clearInterval(timer);
  }, [busy]);

  const choose = (type: UmlType) => {
    setSelected(type);
    const saved = results.current.get(type);
    setState(saved?.state ?? { status: "idle" });
    setLastGenerated(saved?.date);
    setActiveType(saved ? type : "");
    setError("");
  };

  const recommendation = analysis?.recommendations.find(
    (entry) => entry.type === selected,
  );
  const hasDiagram = Boolean(state.diagram);

  return (
    <TooltipProvider delayDuration={500}>
      <main className={styles.controlsTheme}>
        <section
          className={styles.analysis}
          aria-label="Diagram analysis"
          aria-busy={busy}
        >
          <div className={styles.analysisPanel}>
            <div className={styles.analysisHead}>
              <h1 className={styles.analysisTitle}>
                <ActivityMark active={busy} />
                {repository}
              </h1>
              <div className={styles.analysisActions}>
                <a
                  className={styles.actionButton}
                  href={`https://github.com/${repository}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <GitHubIcon width={14} height={14} aria-hidden="true" />
                  GitHub
                </a>
                {busy ? (
                  <button
                    type="button"
                    className={styles.stop}
                    onClick={() => controller.current?.abort()}
                  >
                    <Square size={12} fill="currentColor" aria-hidden="true" />
                    Stop
                  </button>
                ) : (
                  <button
                    type="button"
                    className={styles.actionButton}
                    onClick={() => void run(undefined, true)}
                  >
                    <RefreshCw size={13} aria-hidden="true" />
                    {analysis ? "Reanalyze" : "Analyze"}
                  </button>
                )}
              </div>
            </div>

            {steps.length > 0 && (
              <div
                className={styles.stageList}
                role="status"
                aria-live="polite"
              >
                {steps.map((step, index) => {
                  const active = busy && index === steps.length - 1;
                  return (
                    <div
                      key={`${step.stage}-${index}`}
                      className={styles.stageRow}
                      data-state={active ? "active" : "done"}
                    >
                      <span className={styles.stageIcon}>
                        {active ? (
                          <span className={styles.stageSpinner} />
                        ) : (
                          <Check size={13} aria-hidden="true" />
                        )}
                      </span>
                      <span className={styles.stageMessage}>
                        {step.message}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {busy && (
              <p className={styles.warningLine}>
                {elapsed}s elapsed · the model reads the repository before it
                draws anything
              </p>
            )}
            {error && (
              <p className={styles.errorLine} role="alert">
                <CircleAlert size={15} aria-hidden="true" />
                <span>{error}</span>
              </p>
            )}
            {!error && state.persistenceWarning && (
              <p className={styles.warningLine}>{state.persistenceWarning}</p>
            )}

            {analysis ? (
              <>
                <p className={styles.summary}>{analysis.summary}</p>

                <div className={styles.selectorRow}>
                  <div className={styles.selectField}>
                    <label className={styles.selectLabel} htmlFor="uml-type">
                      Diagram type
                    </label>
                    <select
                      id="uml-type"
                      className={styles.select}
                      value={selected}
                      disabled={busy || analysis.recommendations.length === 0}
                      onChange={(event) =>
                        choose(event.target.value as UmlType)
                      }
                    >
                      {!selected && (
                        <option value="">
                          No diagram is supported by the inspected source
                        </option>
                      )}
                      {Object.entries(UML_TYPES).map(([type, label]) => {
                        const supported = analysis.recommendations.some(
                          (entry) => entry.type === type,
                        );
                        return (
                          <option key={type} value={type} disabled={!supported}>
                            {label}
                            {supported ? "" : " — insufficient evidence"}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <button
                    type="button"
                    className={`${styles.actionButton} ${styles.primary}`}
                    disabled={busy || !selected}
                    onClick={() => selected && void run(selected)}
                  >
                    <Play size={13} aria-hidden="true" />
                    Generate diagram
                  </button>
                </div>

                {recommendation ? (
                  <>
                    <p className={styles.reason}>{recommendation.reason}</p>
                    {selected && UML_NOTATION[selected] && (
                      <p className={styles.notationNote}>
                        {UML_NOTATION[selected]}
                      </p>
                    )}
                    <div className={styles.evidence}>
                      {recommendation.evidence.map((entry, index) => (
                        <a
                          key={`${entry.path}-${index}`}
                          className={styles.evidenceLink}
                          href={
                            entry.path === "README"
                              ? `https://github.com/${repository}#readme`
                              : `https://github.com/${repository}/blob/${branch}/${entry.path
                                  .split("/")
                                  .map(encodeURIComponent)
                                  .join("/")}`
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          title={entry.quote}
                        >
                          <ExternalLink size={11} aria-hidden="true" />
                          {entry.path}
                        </a>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className={styles.callout}>
                    <p className={styles.calloutTitle}>
                      No diagram type is fully supported yet
                    </p>
                    <p>
                      The inspected excerpts do not contain the structures a
                      diagram needs. A smaller repository, or one with more of
                      its source available, gives the analysis more to stand on.
                    </p>
                  </div>
                )}

                {analysis.limitations.length > 0 && (
                  <details className={styles.details}>
                    <summary>
                      Limitations <ChevronDown size={12} aria-hidden="true" />
                    </summary>
                    <ul className={styles.limitations}>
                      {analysis.limitations.map((limitation) => (
                        <li key={limitation}>{limitation}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            ) : (
              !busy &&
              !error && (
                <div className={styles.callout}>
                  <p className={styles.calloutTitle}>No analysis yet</p>
                  <p>
                    Start the analysis to see which diagram types this
                    repository supports.
                  </p>
                </div>
              )
            )}
          </div>
        </section>

        {hasDiagram && (
          <RepositoryWorkspace
            key={activeType || "analysis"}
            repository={repository}
            state={state}
            loading={false}
            lastGenerated={lastGenerated}
            onRegenerate={() => {
              if (activeType) void run(activeType, true);
            }}
            onCancel={() => controller.current?.abort()}
            onRenderError={(message) => setError(message)}
            info={activeType ? <p>{UML_TYPES[activeType]}</p> : undefined}
          />
        )}

        <Toaster />
      </main>
    </TooltipProvider>
  );
}
