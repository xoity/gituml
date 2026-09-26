"use client";

import { useEffect, useRef, useState } from "react";
import { FileSearch, Key, LockKeyhole, Play, Square } from "lucide-react";
import dynamic from "next/dynamic";
import { UML_TYPES, UML_NOTATION } from "~/features/diagram/uml-catalog";
import type { UmlAnalysis, UmlType } from "~/features/diagram/uml";
import type { DiagramStreamState } from "~/features/diagram/types";
import { RepositoryWorkspace } from "~/components/generation/repository-workspace";
import { TooltipProvider } from "~/components/ui/tooltip";
import { Toaster } from "~/components/ui/sonner";
import styles from "~/components/generation/workspace.module.css";

const ApiKeyDialog = dynamic(
  () =>
    import("~/components/api-key-dialog").then((module) => module.ApiKeyDialog),
  { ssr: false },
);
const PrivateReposDialog = dynamic(
  () =>
    import("~/components/private-repos-dialog").then(
      (module) => module.PrivateReposDialog,
    ),
  { ssr: false },
);

export function UmlWorkspace({
  username,
  repo,
}: {
  username: string;
  repo: string;
}) {
  const [analysis, setAnalysis] = useState<UmlAnalysis | null>(null);
  const [selected, setSelected] = useState<UmlType | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [state, setState] = useState<DiagramStreamState>({ status: "idle" });
  const [showKey, setShowKey] = useState(false);
  const [showPrivate, setShowPrivate] = useState(false);
  const [lastGenerated, setLastGenerated] = useState<Date>();
  const [branch, setBranch] = useState("main");
  const [activeType, setActiveType] = useState<UmlType | "">("");
  const controller = useRef<AbortController | null>(null);
  const results = useRef(
    new Map<UmlType, { state: DiagramStreamState; date: Date }>(),
  );
  const repository = `${username}/${repo}`;
  useEffect(() => () => controller.current?.abort(), []);

  async function run(type?: UmlType, refresh = false) {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    setError("");
    if (type)
      setState({
        status: "started",
        startedAt: Date.now(),
        message: `Analyzing ${UML_TYPES[type]} evidence...`,
      });
    try {
      const response = await fetch("/api/uml", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          repo,
          ...(type ? { type } : {}),
          refresh,
        }),
        signal: current.signal,
      });
      const payload: unknown = await response.json();
      const [{ z }, { umlAnalysisSchema, umlDocumentSchema }] =
        await Promise.all([import("zod"), import("~/features/diagram/uml")]);
      const generatedSchema = z.object({
        document: umlDocumentSchema,
        diagram: z.string().min(1).max(100_000),
      });
      if (!response.ok) {
        const failure = z.object({ error: z.string() }).safeParse(payload);
        throw new Error(
          failure.success
            ? failure.data.error
            : "Generation failed. Please retry.",
        );
      }
      if (controller.current !== current) return;
      if (type) {
        const result = generatedSchema.parse(payload);
        const warning = z
          .object({ persistenceWarning: z.string().optional() })
          .parse(payload).persistenceWarning;
        const next: DiagramStreamState = {
          status: "complete",
          diagram: result.diagram,
          explanation: result.document.explanation,
          graph: result.document.graph,
          persistenceWarning: warning,
        };
        const date = new Date();
        results.current.set(type, { state: next, date });
        setState(next);
        setLastGenerated(date);
        setActiveType(type);
      } else {
        const result = z
          .object({ analysis: umlAnalysisSchema, branch: z.string() })
          .parse(payload);
        setAnalysis(result.analysis);
        setBranch(result.branch);
        setSelected(result.analysis.recommendations[0]?.type ?? "");
        results.current.clear();
        setActiveType("");
        setState({ status: "idle" });
      }
    } catch (failure) {
      if (controller.current !== current) return;
      const message = current.signal.aborted
        ? "Generation cancelled."
        : failure instanceof Error
          ? failure.message
          : "Generation failed.";
      setError(message);
      if (type) setState({ status: "error", error: message });
    } finally {
      if (controller.current === current) setBusy(false);
    }
  }

  function choose(type: UmlType) {
    setSelected(type);
    const saved = results.current.get(type);
    setState(saved?.state ?? { status: "idle" });
    setLastGenerated(saved?.date);
    setActiveType(saved ? type : "");
    setError("");
  }
  const recommendation = analysis?.recommendations.find(
    (entry) => entry.type === selected,
  );
  return (
    <TooltipProvider delayDuration={500}>
      <main>
        <section
          className="mx-auto w-full max-w-6xl space-y-5 px-4 py-8 sm:px-8"
          aria-label="UML analysis"
          aria-busy={busy}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="min-w-0 text-2xl font-bold break-all">
              {repository}
            </h1>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={styles.actionButton}
                onClick={() => setShowPrivate(true)}
              >
                <LockKeyhole size={14} aria-hidden="true" />
                Private repository
              </button>
              <button
                type="button"
                className={styles.actionButton}
                onClick={() => setShowKey(true)}
              >
                <Key size={14} aria-hidden="true" />
                OpenCode key
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <button
              type="button"
              disabled={busy}
              className={`${styles.actionButton} ${styles.primary}`}
              onClick={() => void run(undefined, Boolean(analysis))}
            >
              <FileSearch size={16} aria-hidden="true" />
              {analysis ? "Reanalyze repository" : "Analyze repository"}
            </button>
            {analysis && (
              <>
                <div className="min-w-0 flex-1 basis-64 space-y-2">
                  <label
                    htmlFor="uml-type"
                    className="block text-sm font-semibold"
                  >
                    Diagram type
                  </label>
                  <select
                    id="uml-type"
                    value={selected}
                    disabled={busy || !analysis.recommendations.length}
                    onChange={(event) => choose(event.target.value as UmlType)}
                    className="neo-input w-full rounded-md px-3 py-2"
                  >
                    {!selected && (
                      <option value="">No supported diagrams found</option>
                    )}
                    {Object.entries(UML_TYPES).map(([type, label]) => (
                      <option
                        key={type}
                        value={type}
                        disabled={
                          !analysis.recommendations.some(
                            (entry) => entry.type === type,
                          )
                        }
                      >
                        {label}
                        {!analysis.recommendations.some(
                          (entry) => entry.type === type,
                        )
                          ? " (insufficient evidence)"
                          : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  disabled={busy || !selected}
                  className={`${styles.actionButton} ${styles.primary}`}
                  onClick={() => selected && void run(selected)}
                >
                  <Play size={14} aria-hidden="true" />
                  Generate
                </button>
              </>
            )}
            {busy && (
              <button
                type="button"
                className={styles.actionButton}
                onClick={() => controller.current?.abort()}
              >
                <Square size={14} aria-hidden="true" />
                Cancel
              </button>
            )}
          </div>
          {busy && (
            <p role="status">
              {state.status === "started"
                ? state.message
                : "Inspecting repository source and diagram applicability..."}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-300">
              {error}
            </p>
          )}
          {state.persistenceWarning && (
            <p role="status" className="text-sm">
              {state.persistenceWarning}
            </p>
          )}
          {analysis && (
            <p className="max-w-4xl text-sm leading-relaxed">
              {analysis.summary}
            </p>
          )}
          {recommendation && (
            <div className="space-y-2 border-l-2 border-current pl-4 text-sm">
              <p>{recommendation.reason}</p>
              {selected && UML_NOTATION[selected] && (
                <p className="opacity-75">{UML_NOTATION[selected]}</p>
              )}
              <div className="flex flex-wrap gap-3">
                {recommendation.evidence.map((entry, index) => (
                  <a
                    key={`${entry.path}-${index}`}
                    href={`https://github.com/${encodeURIComponent(username)}/${encodeURIComponent(repo)}/${entry.path === "README" ? "" : `blob/${encodeURIComponent(branch)}/${entry.path.split("/").map(encodeURIComponent).join("/")}`}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={entry.quote}
                    className="break-all underline underline-offset-4"
                  >
                    {entry.path}
                  </a>
                ))}
              </div>
            </div>
          )}
          {analysis && analysis.limitations.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer font-semibold">
                Analysis limitations
              </summary>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {analysis.limitations.map((limitation) => (
                  <li key={limitation}>{limitation}</li>
                ))}
              </ul>
            </details>
          )}
        </section>
        <div hidden={state.status === "idle"}>
          <RepositoryWorkspace
            key={selected || "analysis"}
            repository={repository}
            state={state}
            loading={busy && state.status === "started"}
            lastGenerated={lastGenerated}
            onRegenerate={() => {
              if (activeType) void run(activeType, true);
            }}
            onCancel={() => controller.current?.abort()}
            onRenderError={(message) => {
              setError(message);
              setState((previous) => ({
                ...previous,
                status: "error",
                error: message,
              }));
            }}
            info={activeType ? <p>{UML_TYPES[activeType]}</p> : undefined}
          />
        </div>
        <ApiKeyDialog
          isOpen={showKey}
          onClose={() => setShowKey(false)}
          onSaved={() => setShowKey(false)}
        />
        <PrivateReposDialog
          isOpen={showPrivate}
          repository={repository}
          onClose={() => setShowPrivate(false)}
          onSaved={() => setShowPrivate(false)}
        />
        <Toaster />
      </main>
    </TooltipProvider>
  );
}
