import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UmlWorkspace } from "./uml-workspace";

vi.mock("~/components/generation/repository-workspace", () => ({
  RepositoryWorkspace: ({ state }: { state: { diagram?: string } }) => (
    <div data-testid="diagram">{state.diagram}</div>
  ),
}));
vi.mock("~/components/api-key-dialog", () => ({ ApiKeyDialog: () => null }));
vi.mock("~/components/private-repos-dialog", () => ({
  PrivateReposDialog: () => null,
}));
vi.mock("~/components/ui/sonner", () => ({ Toaster: () => null }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("UML chooser", () => {
  it("analyzes before generation, disables unsupported types, and clears old diagrams on selection", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          branch: "main",
          analysis: {
            summary: "A class-based application",
            recommendations: ["class", "sequence"].map((type) => ({
              type,
              reason: "Source supports this view",
              evidence: [{ path: "app.ts", quote: "class App extends Base" }],
            })),
            limitations: [],
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          diagram: "classDiagram\nclass App",
          document: {
            type: "class",
            title: "App",
            explanation: "Application class",
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
            nodeEvidence: [
              {
                node: "app",
                evidence: { path: "app.ts", quote: "class App extends Base" },
              },
            ],
            edgeDetails: [],
            members: [],
            intervals: [],
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(<UmlWorkspace username="owner" repo="repo" />);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Analyze repository" }));
    const select = await screen.findByRole("combobox", {
      name: "Diagram type",
    });
    expect(
      screen.getByRole("option", {
        name: "Timing Diagram (insufficient evidence)",
      }),
    ).toBeDisabled();
    expect(select).toHaveValue("class");
    fireEvent.click(screen.getByRole("button", { name: /^Generate$/ }));
    await waitFor(() =>
      expect(screen.getByTestId("diagram")).toHaveTextContent("classDiagram"),
    );
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toMatchObject({
      username: "owner",
      repo: "repo",
      type: "class",
    });
    fireEvent.change(select, { target: { value: "sequence" } });
    expect(screen.getByTestId("diagram")).toBeEmptyDOMElement();
    fireEvent.change(select, { target: { value: "class" } });
    expect(screen.getByTestId("diagram")).toHaveTextContent("classDiagram");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
