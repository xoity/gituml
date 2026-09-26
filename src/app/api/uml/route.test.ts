import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
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
}));
vi.mock("~/server/http/request-credentials", () => ({
  resolveRequestCredentials: mocks.credentials,
}));
vi.mock("~/server/generate/github", () => ({ getGithubData: mocks.github }));
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
vi.mock("~/server/storage/r2", () => ({
  getJsonObject: mocks.read,
  putJsonObject: mocks.write,
}));

import { POST } from "./route";

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
beforeEach(() => {
  vi.resetAllMocks();
  mocks.credentials.mockResolvedValue({ opencodeApiKey: "test-key" });
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
});
afterEach(() => vi.unstubAllEnvs());

describe("UML route", () => {
  it("isolates private cached analysis and rechecks access before reading it", async () => {
    for (const name of [
      "R2_ACCOUNT_ID",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "R2_PUBLIC_BUCKET",
      "R2_PRIVATE_BUCKET",
      "CACHE_KEY_SECRET",
    ])
      vi.stubEnv(name, `test-${name}`);
    mocks.credentials.mockResolvedValue({
      opencodeApiKey: "test-key",
      githubPat: "private-token",
    });
    mocks.github.mockResolvedValue({
      defaultBranch: "main",
      fileTree: "app.ts",
      readme: "A project",
      pathTypes: new Map([["app.ts", "blob"]]),
      isPrivate: true,
    });
    expect((await POST(request())).status).toBe(200);
    const [bucket, key, cached] = mocks.write.mock.calls[0]!;
    expect(bucket).toBe("test-R2_PRIVATE_BUCKET");
    expect(key).toMatch(
      /^uml\/v1\/private\/v1\/[a-f0-9]{64}\/owner\/repo\.json\/analysis\.json$/,
    );
    expect(key).not.toContain("private-token");
    mocks.read.mockResolvedValue(cached);
    mocks.model.mockClear();
    expect((await POST(request())).status).toBe(200);
    expect(mocks.model).not.toHaveBeenCalled();
    mocks.github.mockRejectedValue(new Error("Repository not found."));
    mocks.read.mockClear();
    expect((await POST(request())).status).toBe(502);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("rejects cross-origin, unsupported type and oversized input before paid work", async () => {
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
  it("returns only evidence-checked recommendations without caching private responses", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      analysis: {
        summary: analysis.summary,
        recommendations: analysis.recommendations,
      },
    });
    expect(mocks.model).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "opencode",
        model: "deepseek-v4-flash-vision-exp",
        apiKey: "test-key",
      }),
    );
  });
  it("repairs fabricated citations and never accepts them silently", async () => {
    mocks.model.mockResolvedValueOnce({
      output: {
        ...analysis,
        recommendations: [
          {
            ...analysis.recommendations[0],
            evidence: [{ path: "missing.ts", quote }],
          },
        ],
      },
      usage: { totalTokens: 20 },
    });
    expect((await POST(request())).status).toBe(200);
    expect(mocks.model).toHaveBeenCalledTimes(2);
    expect(mocks.model.mock.calls[1]?.[0].userPrompt).toContain(
      "Validation failed",
    );
  });
  it("fails closed when server-funded quota cannot be read", async () => {
    vi.stubEnv("OPENCODE_API_KEY", "server-test");
    mocks.credentials.mockResolvedValue({});
    mocks.quota.mockRejectedValue(new Error("Redis unavailable"));
    expect((await POST(request())).status).toBe(503);
    expect(mocks.model).not.toHaveBeenCalled();
  });
  it("reconciles successful server-funded work", async () => {
    vi.stubEnv("OPENCODE_API_KEY", "server-test");
    mocks.credentials.mockResolvedValue({});
    expect((await POST(request())).status).toBe(200);
    expect(mocks.started).toHaveBeenCalledOnce();
    expect(mocks.commit).toHaveBeenCalledWith(
      expect.objectContaining({
        committedTokens: 30,
        quotaBucket: "gituml-opencode",
      }),
    );
  });
});
