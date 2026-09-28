import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  credentials: vi.fn(),
  github: vi.fn(),
  source: vi.fn(),
  model: vi.fn(),
  quota: vi.fn(),
  started: vi.fn(),
  commit: vi.fn(),
  rate: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  browse: vi.fn(),
}));

vi.mock("~/server/http/request-credentials", () => ({
  resolveRequestCredentials: mocks.credentials,
}));
vi.mock("~/server/generate/github", () => ({
  getGithubData: mocks.github,
  REPOSITORY_TOO_LARGE_ERROR:
    "Repository is too large for analysis. Try a smaller repo.",
}));
vi.mock("~/server/generate/source-context", () => ({
  fetchSourceContext: mocks.source,
}));
vi.mock("~/server/generate/openai", () => ({
  generateStructuredOutput: mocks.model,
}));
vi.mock("~/server/generate/rate-limit", () => ({
  consumeGenerationInfrastructureRateLimit: mocks.rate,
  consumeGenerationRateLimit: mocks.rate,
}));
vi.mock("~/server/storage/quota-store", () => ({
  checkQuotaInUpstash: mocks.quota,
  markQuotaReservationStartedInUpstash: mocks.started,
  commitQuotaUsageInUpstash: mocks.commit,
}));
vi.mock("~/server/storage/browse-diagrams", () => ({
  upsertBrowseIndexEntry: mocks.browse,
}));
vi.mock("~/server/storage/r2", () => ({
  getJsonObject: mocks.read,
  putJsonObject: mocks.write,
}));

import { POST } from "./route";
import { IncompleteStructuredOutputError } from "~/server/generate/errors";

const quote = "export class Application {}";
const analysis = {
  summary: "A class-based application.",
  recommendations: [
    {
      type: "class",
      reason: "A concrete class is declared.",
      evidence: [{ path: "app.ts", quote }],
    },
  ],
  limitations: ["One source file inspected."],
};

function request(
  body: unknown = { username: "owner", repo: "repo" },
  origin = "https://gituml.example",
) {
  return new Request("https://gituml.example/api/uml", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });
}

interface StreamEvent {
  stage?: string;
  message?: string;
  result?: Record<string, unknown>;
  error?: string;
  errorCode?: string;
}

async function readEvents(response: Response): Promise<StreamEvent[]> {
  const text = await response.text();
  return text
    .split("\n\n")
    .filter((frame) => frame.trim().length > 0)
    .map((frame) => JSON.parse(frame.replace(/^data: /, "")) as StreamEvent);
}

function stubStorageEnv() {
  for (const name of [
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_PUBLIC_BUCKET",
    "R2_PRIVATE_BUCKET",
    "CACHE_KEY_SECRET",
  ]) {
    vi.stubEnv(name, `test-${name}`);
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("AI_PROVIDER", "opencode");
  vi.stubEnv("OPENCODE_API_KEY", "server-key");
  // The local .env may switch metering off; these cases cover the metered path.
  vi.stubEnv("UML_BUDGET_UNMETERED", "");
  mocks.credentials.mockResolvedValue({});
  mocks.rate.mockResolvedValue({ allowed: true });
  mocks.github.mockResolvedValue({
    defaultBranch: "main",
    fileTree: "app.ts",
    readme: "A project",
    pathTypes: new Map([["app.ts", "blob"]]),
    isPrivate: false,
  });
  mocks.source.mockResolvedValue({
    paths: ["app.ts"],
    unavailableCount: 0,
    excerpts: [{ path: "app.ts", text: quote }],
    text: quote,
  });
  mocks.model.mockResolvedValue({
    output: analysis,
    usage: { totalTokens: 30 },
  });
  mocks.quota.mockResolvedValue({ admitted: true });
  mocks.commit.mockResolvedValue(undefined);
  mocks.read.mockResolvedValue(null);
  mocks.write.mockResolvedValue(undefined);
  mocks.browse.mockResolvedValue([]);
});

afterEach(() => vi.unstubAllEnvs());

describe("UML route", () => {
  it("rejects bad requests before doing any work", async () => {
    expect(
      (await POST(request(undefined, "https://evil.example"))).status,
    ).toBe(403);
    expect(
      (
        await POST(
          request({ username: "owner", repo: "repo", type: "invented" }),
        )
      ).status,
    ).toBe(400);
    expect(
      (await POST(request({ username: "owner", repo: "x".repeat(17000) })))
        .status,
    ).toBe(413);
    expect(mocks.model).not.toHaveBeenCalled();
  });

  it("streams its progress and returns the evidence-checked analysis", async () => {
    const response = await POST(request());
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const events = await readEvents(response);
    const stages = events
      .map((event) => event.stage)
      .filter((stage): stage is string => Boolean(stage));
    expect(stages).toEqual(
      expect.arrayContaining(["repository", "sources", "validating"]),
    );
    expect(events.at(-1)?.result).toMatchObject({
      analysis: { summary: analysis.summary },
      branch: "main",
    });
    // The operator's provider and key fund the run; the caller's cookie is not
    // forwarded to a provider the operator did not choose.
    expect(mocks.model).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "opencode",
        model: "deepseek-v4-flash-vision-exp",
        apiKey: undefined,
      }),
    );
  });

  it("repairs a truncated response instead of failing the run", async () => {
    mocks.model
      .mockRejectedValueOnce(
        new IncompleteStructuredOutputError("The response was cut off."),
      )
      .mockResolvedValueOnce({ output: analysis, usage: { totalTokens: 40 } });

    const events = await readEvents(await POST(request()));
    expect(mocks.model).toHaveBeenCalledTimes(2);
    expect(events.some((event) => event.stage === "retrying")).toBe(true);
    expect(events.at(-1)?.result).toBeTruthy();
    expect(mocks.model.mock.calls[1]?.[0].userPrompt).toContain(
      "failed validation",
    );
  });

  it("stops honestly when the model keeps returning unusable output", async () => {
    mocks.model.mockRejectedValue(
      new IncompleteStructuredOutputError("The response was cut off."),
    );

    const events = await readEvents(await POST(request()));
    expect(events.at(-1)?.error).toContain("could not produce a complete");
    expect(events.some((event) => event.result)).toBe(false);
  });

  it("fails closed when the daily budget cannot be read", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "token");
    mocks.quota.mockRejectedValue(new Error("Redis unavailable"));

    const events = await readEvents(await POST(request()));
    expect(events.at(-1)).toMatchObject({ errorCode: "QUOTA_UNAVAILABLE" });
    expect(mocks.model).not.toHaveBeenCalled();
  });

  it("names the budget variables the operator still has to set", async () => {
    mocks.quota.mockRejectedValue(new Error("Redis unavailable"));

    const events = await readEvents(await POST(request()));
    expect(events.at(-1)).toMatchObject({
      errorCode: "QUOTA_NOT_CONFIGURED",
    });
    expect(events.at(-1)?.error).toContain("UPSTASH_REDIS_REST_URL");
    expect(mocks.model).not.toHaveBeenCalled();
  });

  it("skips the budget ledger only when the operator turns metering off", async () => {
    vi.stubEnv("UML_BUDGET_UNMETERED", "1");
    mocks.quota.mockRejectedValue(new Error("Redis unavailable"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const events = await readEvents(await POST(request()));

    expect(events.at(-1)?.result).toBeTruthy();
    expect(mocks.quota).not.toHaveBeenCalled();
    expect(
      warn.mock.calls.some((call) =>
        String(call[0]).includes("uml.budget_unmetered"),
      ),
    ).toBe(true);
  });

  it("says which key the operator must set, and never asks the visitor for one", async () => {
    vi.stubEnv("OPENCODE_API_KEY", "");
    const events = await readEvents(await POST(request()));
    expect(events.at(-1)).toMatchObject({ errorCode: "NO_SERVER_KEY" });
    expect(events.at(-1)?.error).toContain("OPENCODE_API_KEY");
  });

  it("adds a saved public result to the browse index, and never a private one", async () => {
    stubStorageEnv();

    await readEvents(await POST(request()));
    expect(mocks.browse).toHaveBeenCalledWith(
      expect.objectContaining({ username: "owner", repo: "repo" }),
    );

    // A private repository must stay out of the shared catalog.
    mocks.browse.mockClear();
    mocks.credentials.mockResolvedValue({ githubPat: "private-token" });
    mocks.github.mockResolvedValue({
      defaultBranch: "main",
      fileTree: "app.ts",
      readme: "A project",
      pathTypes: new Map([["app.ts", "blob"]]),
      isPrivate: true,
    });
    await readEvents(await POST(request()));
    expect(mocks.browse).not.toHaveBeenCalled();
  });

  it("verifies access before reading a cached private result", async () => {
    stubStorageEnv();
    mocks.credentials.mockResolvedValue({ githubPat: "private-token" });
    mocks.github.mockResolvedValue({
      defaultBranch: "main",
      fileTree: "app.ts",
      readme: "A project",
      pathTypes: new Map([["app.ts", "blob"]]),
      isPrivate: true,
    });

    // Reading the stream is what drives the run to completion.
    await readEvents(await POST(request()));
    const [bucket, key, cached] = mocks.write.mock.calls[0]!;
    expect(bucket).toBe("test-R2_PRIVATE_BUCKET");
    expect(key).toMatch(
      /^uml\/v1\/private\/v1\/[a-f0-9]{64}\/owner\/repo\.json\/analysis\.json$/,
    );
    expect(key).not.toContain("private-token");

    mocks.read.mockResolvedValue(cached);
    mocks.model.mockClear();
    const cachedEvents = await readEvents(await POST(request()));
    expect(cachedEvents.at(-1)?.result).toBeTruthy();
    expect(mocks.model).not.toHaveBeenCalled();

    // A caller who cannot read the repository never reaches the cache.
    mocks.github.mockRejectedValue(new Error("Repository not found."));
    mocks.read.mockClear();
    await readEvents(await POST(request()));
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
