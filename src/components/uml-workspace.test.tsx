import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UmlWorkspace } from "./uml-workspace";

vi.mock("~/components/generation/repository-workspace", () => ({
  RepositoryWorkspace: ({ state }: { state: { diagram?: string } }) => (
    <div data-testid="diagram">{state.diagram}</div>
  ),
}));
vi.mock("~/components/ui/sonner", () => ({ Toaster: () => null }));

const quote = "class App extends Base";
const analysis = {
  summary: "A class-based application.",
  recommendations: [
    {
      type: "class",
      reason: "Source declares a class.",
      evidence: [{ path: "app.ts", quote }],
    },
    {
      type: "sequence",
      reason: "Calls are ordered.",
      evidence: [{ path: "app.ts", quote }],
    },
  ],
  limitations: ["Only one file inspected."],
};
const umlDocument = {
  type: "class",
  title: "App",
  explanation: "The application class.",
  graph: {
    groups: [],
    nodes: [
      {
        id: "app",
        label: "App",
        type: "class",
        description: null,
        path: "app.ts",
        groupId: null,
        shape: "box",
      },
    ],
    edges: [],
  },
  nodeEvidence: [{ node: "app", evidence: { path: "app.ts", quote } }],
  edgeDetails: [],
  members: [],
  intervals: [],
};

function sseResponse(events: unknown[]) {
  return new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

/** A stream the test pushes events into, so progress can be observed mid-run. */
function controllableStream() {
  let streamController!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
    },
  });
  return {
    response: new Response(stream, {
      headers: { "Content-Type": "text/event-stream" },
    }),
    push: (event: unknown) =>
      streamController.enqueue(
        new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`),
      ),
    close: () => streamController.close(),
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("UML workspace", () => {
  it("analyzes the repository as soon as the page opens", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        sseResponse([
          { stage: "repository", message: "Reading owner/repo" },
          { result: { analysis, branch: "main", sourcePaths: ["app.ts"] } },
        ]),
      )
      .mockResolvedValueOnce(
        sseResponse([
          { stage: "compiling", message: "Compiling Mermaid" },
          { result: { diagram: "classDiagram", document: umlDocument } },
        ]),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<UmlWorkspace username="owner" repo="repo" />);

    // No button press: navigating here is the decision to analyze.
    expect(
      await screen.findByText("A class-based application."),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({
      username: "owner",
      repo: "repo",
    });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).type).toBeUndefined();

    // Nothing is drawn until a type is generated.
    expect(screen.queryByTestId("diagram")).toBeNull();
    expect(screen.getByRole("combobox", { name: "Diagram type" })).toHaveValue(
      "class",
    );
    expect(
      screen.getByRole("option", {
        name: "Timing Diagram — insufficient evidence",
      }),
    ).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Generate diagram" }));
    expect(await screen.findByTestId("diagram")).toHaveTextContent(
      "classDiagram",
    );
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toMatchObject({
      type: "class",
    });
  });

  it("shows where the run is while it is still working", async () => {
    const stream = controllableStream();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(stream.response));

    render(<UmlWorkspace username="owner" repo="repo" />);

    stream.push({ stage: "repository", message: "Reading owner/repo" });
    expect(await screen.findByText("Reading owner/repo")).toBeInTheDocument();

    stream.push({ stage: "sources", message: "Inspected 1 source file" });
    expect(
      await screen.findByText("Inspected 1 source file"),
    ).toBeInTheDocument();
    expect(screen.getByText(/elapsed/)).toBeInTheDocument();

    stream.push({
      result: { analysis, branch: "main", sourcePaths: ["app.ts"] },
    });
    stream.close();
    expect(
      await screen.findByText("A class-based application."),
    ).toBeInTheDocument();
  });

  it("keeps each generated diagram and clears the old one when the type changes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        sseResponse([
          { result: { analysis, branch: "main", sourcePaths: [] } },
        ]),
      )
      .mockResolvedValueOnce(
        sseResponse([
          { result: { diagram: "classDiagram", document: umlDocument } },
        ]),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(<UmlWorkspace username="owner" repo="repo" />);

    const select = await screen.findByRole("combobox", {
      name: "Diagram type",
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate diagram" }));
    expect(await screen.findByTestId("diagram")).toHaveTextContent(
      "classDiagram",
    );

    // Switching to a type that has not been generated yet shows no stale figure.
    fireEvent.change(select, { target: { value: "sequence" } });
    expect(screen.queryByTestId("diagram")).toBeNull();

    // Returning to the generated one restores it without another request.
    fireEvent.change(select, { target: { value: "class" } });
    expect(screen.getByTestId("diagram")).toHaveTextContent("classDiagram");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports a failure instead of pretending a diagram was made", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          { stage: "repository", message: "Reading owner/repo" },
          {
            error: "The model could not produce a complete diagram.",
            errorCode: "INCOMPLETE",
          },
        ]),
      ),
    );
    render(<UmlWorkspace username="owner" repo="repo" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The model could not produce a complete diagram.",
    );
    expect(screen.queryByTestId("diagram")).toBeNull();
  });
});
