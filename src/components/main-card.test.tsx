import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MainCard from "~/components/main-card";

const push = vi.fn();
const credentials = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("~/features/credentials/api", () => ({
  saveCredential: credentials.save,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push,
  }),
}));

describe("MainCard", () => {
  beforeEach(() => {
    push.mockReset();
    credentials.save.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("accepts owner/repo shorthand input", () => {
    render(<MainCard />);

    const input = screen.getByRole("textbox", {
      name: "GitHub repository",
    });
    fireEvent.change(input, {
      target: { value: "facebook/react" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));

    expect(push).toHaveBeenCalledWith("/facebook/react");
    expect(
      screen.queryByText(
        "Please enter a valid GitHub repository URL or owner/repo",
      ),
    ).not.toBeInTheDocument();
  });

  it("associates invalid input feedback with the repository field", () => {
    render(<MainCard />);

    const input = screen.getByRole("textbox", {
      name: "GitHub repository",
    });
    fireEvent.change(input, { target: { value: "not-a-repository" } });
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));

    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(
      "Please enter a valid GitHub repository URL or owner/repo",
    );
  });

  it("lets example repositories navigate without submitting the required input", () => {
    render(<MainCard />);

    const exampleButton = screen.getByRole("button", { name: "FastAPI" });
    expect(exampleButton).toHaveAttribute("type", "button");

    fireEvent.click(exampleButton);

    expect(push).toHaveBeenCalledWith("/fastapi/fastapi");
    expect(
      screen.queryByText(
        "Please enter a valid GitHub repository URL or owner/repo",
      ),
    ).not.toBeInTheDocument();
  });

  it("saves private access before navigating and stops when saving fails", async () => {
    render(<MainCard />);
    fireEvent.change(
      screen.getByRole("textbox", { name: "GitHub repository" }),
      { target: { value: "owner/private" } },
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Private repository" }),
    );
    fireEvent.change(screen.getByLabelText("GitHub personal access token"), {
      target: { value: "test-token" },
    });
    credentials.save.mockRejectedValueOnce(new Error("Unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
    await screen.findByText("Could not save the GitHub token. Please retry.");
    expect(push).not.toHaveBeenCalled();
    credentials.save.mockResolvedValueOnce({ githubPatConfigured: true });
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/owner/private"));
    expect(credentials.save).toHaveBeenCalledWith("github_pat", "test-token");
  });
});
