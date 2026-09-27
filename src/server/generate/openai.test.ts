import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const openAiMocks = vi.hoisted(() => ({
  clientOptions: vi.fn(),
  responsesCreate: vi.fn(),
  responsesParse: vi.fn(),
  responsesRetrieve: vi.fn(),
  chatCreate: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    constructor(options: unknown) {
      openAiMocks.clientOptions(options);
    }

    responses = {
      create: openAiMocks.responsesCreate,
      parse: openAiMocks.responsesParse,
      retrieve: openAiMocks.responsesRetrieve,
    };
    chat = { completions: { create: openAiMocks.chatCreate } };
  },
}));

import {
  IncompleteStructuredOutputError,
  UpstreamProviderError,
} from "~/server/generate/errors";
import {
  generateStructuredOutput,
  streamCompletion,
} from "~/server/generate/openai";

async function* asAsyncEvents(events: unknown[]) {
  for (const event of events) {
    yield event;
  }
}

async function consume(stream: AsyncGenerator<string, void, void>) {
  const chunks: string[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

function completedEvents(text = "done") {
  return asAsyncEvents([
    { type: "response.output_text.delta", delta: text },
    {
      type: "response.completed",
      response: {
        id: "resp_test",
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      },
    },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllEnvs());

describe("OpenCode Go", () => {
  it("uses Chat Completions with a stable session and validates JSON locally", async () => {
    openAiMocks.chatCreate.mockResolvedValue({
      choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
    });
    const result = await generateStructuredOutput({
      provider: "opencode",
      model: "deepseek-v4-flash-vision-exp",
      apiKey: "test-key",
      systemPrompt: "system",
      userPrompt: "user",
      schema: z.object({ ok: z.boolean() }),
      schemaName: "test",
      clientRequestId: "stable-session:graph:2",
    });
    expect(result.output).toEqual({ ok: true });
    expect(result.usage).toMatchObject({ inputTokens: 20, outputTokens: 5 });
    expect(openAiMocks.clientOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: "https://opencode.ai/zen/go/v1",
        defaultHeaders: { "User-Agent": "gituml/0.1" },
        timeout: 150_000,
        maxRetries: 0,
      }),
    );
    expect(openAiMocks.chatCreate).toHaveBeenCalledWith(
      expect.objectContaining({ response_format: { type: "json_object" } }),
      { headers: { "x-opencode-session": "stable-session" } },
    );
    expect(openAiMocks.responsesParse).not.toHaveBeenCalled();
  });
  it("marks a cut-off or empty response retryable, and a wrong shape a schema failure", async () => {
    const request = () =>
      generateStructuredOutput({
        provider: "opencode" as const,
        model: "deepseek-v4-flash-vision-exp",
        apiKey: "test-key",
        systemPrompt: "system",
        userPrompt: "user",
        schema: z.object({ ok: z.boolean() }),
        schemaName: "test",
      });

    // Truncated and empty are the app's to retry, not the provider's to report.
    for (const [finish_reason, content] of [
      ["length", '{"ok":true}'],
      ["stop", "   "],
    ]) {
      openAiMocks.chatCreate.mockResolvedValue({
        choices: [{ finish_reason, message: { content } }],
      });
      await expect(request()).rejects.toBeInstanceOf(
        IncompleteStructuredOutputError,
      );
    }

    // A complete but wrong-shaped object is a schema failure.
    openAiMocks.chatCreate.mockResolvedValue({
      choices: [
        { finish_reason: "stop", message: { content: '{"ok":"wrong"}' } },
      ],
    });
    await expect(request()).rejects.toBeInstanceOf(UpstreamProviderError);
  });

  it("accepts an object wrapped in a fenced block", async () => {
    openAiMocks.chatCreate.mockResolvedValue({
      choices: [
        {
          finish_reason: "stop",
          message: { content: 'Here it is:\n```json\n{"ok":true}\n```' },
        },
      ],
    });

    const result = await generateStructuredOutput({
      provider: "opencode",
      model: "deepseek-v4-flash-vision-exp",
      apiKey: "test-key",
      systemPrompt: "system",
      userPrompt: "user",
      schema: z.object({ ok: z.boolean() }),
      schemaName: "test",
    });

    expect(result.output).toEqual({ ok: true });
  });
  it("streams Chat Completions and closes the underlying stream", async () => {
    const abort = vi.fn();
    openAiMocks.chatCreate.mockResolvedValue(
      Object.assign(
        asAsyncEvents([
          { choices: [{ delta: { content: "hello" }, finish_reason: null }] },
          { choices: [{ delta: {}, finish_reason: "stop" }] },
          {
            choices: [],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 2,
              total_tokens: 12,
            },
          },
        ]),
        { controller: { abort } },
      ),
    );
    const result = await streamCompletion({
      provider: "opencode",
      model: "deepseek-v4-flash-vision-exp",
      apiKey: "test-key",
      systemPrompt: "system",
      userPrompt: "user",
    });
    expect(await consume(result.stream)).toEqual(["hello"]);
    expect(await result.usagePromise).toMatchObject({
      inputTokens: 10,
      outputTokens: 2,
    });
    expect(abort).toHaveBeenCalled();
  });
});

describe("OpenAI Responses text verbosity", () => {
  it.each(["gpt-5.6-luna", "gpt-6-luna"])(
    "requests Fast for managed %s and retains the tier actually served",
    async (model) => {
      vi.stubEnv("OPENAI_API_KEY", "sk-managed-test");
      openAiMocks.responsesCreate.mockResolvedValue(completedEvents());
      const stream = await streamCompletion({
        provider: "openai",
        model,
        systemPrompt: "system",
        userPrompt: "user",
      });
      await consume(stream.stream);
      expect(openAiMocks.responsesCreate).toHaveBeenCalledWith(
        expect.objectContaining({ service_tier: "priority" }),
        undefined,
      );
      openAiMocks.responsesParse.mockResolvedValue({
        output_parsed: { ok: true },
        output_text: '{"ok":true}',
        service_tier: "default",
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      });
      const graph = await generateStructuredOutput({
        provider: "openai",
        model,
        systemPrompt: "system",
        userPrompt: "user",
        schema: z.object({ ok: z.boolean() }),
        schemaName: "test",
      });
      expect(openAiMocks.responsesParse).toHaveBeenCalledWith(
        expect.objectContaining({ service_tier: "priority" }),
        undefined,
      );
      expect(graph.usage?.serviceTier).toBe("default");
    },
  );
  it("bounds costly requests and attaches a production correlation id", async () => {
    openAiMocks.responsesCreate.mockResolvedValue(completedEvents());
    const signal = new AbortController().signal;

    const result = await streamCompletion({
      provider: "openai",
      model: "gpt-5.6-terra",
      systemPrompt: "system",
      userPrompt: "user",
      apiKey: "sk-test",
      signal,
      clientRequestId: "session:explanation",
    });

    await consume(result.stream);
    expect(openAiMocks.responsesCreate.mock.calls[0]?.[0]).not.toHaveProperty(
      "max_output_tokens",
    );
    expect(openAiMocks.clientOptions).toHaveBeenCalledWith(
      expect.objectContaining({ maxRetries: 0, timeout: 150_000 }),
    );
    expect(openAiMocks.responsesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ service_tier: "default" }),
      {
        signal,
        headers: { "X-Client-Request-Id": "session:explanation" },
      },
    );
  });

  it("sends text.verbosity for an exact dated GPT-5.6 streaming model", async () => {
    openAiMocks.responsesCreate.mockResolvedValue(completedEvents());

    const result = await streamCompletion({
      provider: "openai",
      model: "gpt-5.6-terra-2026-07-09",
      systemPrompt: "system",
      userPrompt: "user",
      apiKey: "sk-test",
      textVerbosity: "low",
    });

    await expect(consume(result.stream)).resolves.toEqual(["done"]);
    await expect(result.usagePromise).resolves.toMatchObject({
      totalTokens: 15,
    });
    expect(openAiMocks.responsesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ text: { verbosity: "low" } }),
      undefined,
    );
  });

  it("omits text.verbosity for unsupported models and providers", async () => {
    openAiMocks.responsesCreate
      .mockResolvedValueOnce(completedEvents())
      .mockResolvedValueOnce(completedEvents());

    const oldModelResult = await streamCompletion({
      provider: "openai",
      model: "gpt-5.4",
      systemPrompt: "system",
      userPrompt: "user",
      apiKey: "sk-test",
      textVerbosity: "low",
    });
    await consume(oldModelResult.stream);

    const proxyResult = await streamCompletion({
      provider: "openrouter",
      model: "gpt-5.6-terra",
      systemPrompt: "system",
      userPrompt: "user",
      apiKey: "sk-test",
      textVerbosity: "low",
    });
    await consume(proxyResult.stream);

    expect(openAiMocks.responsesCreate.mock.calls[1]?.[0]).not.toHaveProperty(
      "service_tier",
    );
    for (const [body] of openAiMocks.responsesCreate.mock.calls) {
      expect(body).not.toHaveProperty("text");
    }
  });

  it("merges verbosity with the structured-output text format", async () => {
    const schema = z.object({ value: z.string() });
    openAiMocks.responsesParse.mockResolvedValue({
      output_parsed: { value: "ok" },
      output_text: '{"value":"ok"}',
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    });

    await generateStructuredOutput({
      provider: "openai",
      model: "gpt-5.6-luna",
      systemPrompt: "system",
      userPrompt: "user",
      schema,
      schemaName: "payload",
      apiKey: "sk-test",
      textVerbosity: "low",
    });

    const [body] = openAiMocks.responsesParse.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(body.service_tier).toBe("default");
    expect(body).not.toHaveProperty("max_output_tokens");
    expect(body.text).toEqual(
      expect.objectContaining({
        format: expect.objectContaining({ type: "json_schema" }),
        verbosity: "low",
      }),
    );
  });
});

describe("OpenAI Responses incomplete streams", () => {
  it("fails even when an incomplete response already emitted visible output", async () => {
    openAiMocks.responsesCreate.mockResolvedValue(
      asAsyncEvents([
        { type: "response.output_text.delta", delta: "partial" },
        {
          type: "response.incomplete",
          response: {
            id: "resp_incomplete",
            incomplete_details: { reason: "max_output_tokens" },
            usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
          },
        },
      ]),
    );

    const result = await streamCompletion({
      provider: "openai",
      model: "gpt-5.6-terra",
      systemPrompt: "system",
      userPrompt: "user",
      apiKey: "sk-test",
      textVerbosity: "low",
    });

    await expect(consume(result.stream)).rejects.toThrow(
      "OpenAI response incomplete: max_output_tokens.",
    );
    await expect(result.usagePromise).resolves.toBeNull();
  });

  it("rejects a stream that ends without a terminal response event", async () => {
    openAiMocks.responsesCreate.mockResolvedValue(
      asAsyncEvents([{ type: "response.output_text.delta", delta: "partial" }]),
    );

    const result = await streamCompletion({
      provider: "openai",
      model: "gpt-5.6-terra",
      systemPrompt: "system",
      userPrompt: "user",
      apiKey: "sk-test",
    });

    await expect(consume(result.stream)).rejects.toThrow(
      "OpenAI stream ended before response.completed.",
    );
    await expect(result.usagePromise).resolves.toBeNull();
  });
});

describe("generateStructuredOutput error classification", () => {
  const schema = z.object({ value: z.string() });

  function requestStructuredOutput() {
    return generateStructuredOutput({
      provider: "openrouter",
      model: "some/openrouter-model",
      systemPrompt: "system",
      userPrompt: "user",
      schema,
      schemaName: "payload",
      apiKey: "sk-or-test",
    });
  }

  it("propagates an abort unchanged instead of calling it a capability failure", async () => {
    const abortError = new DOMException(
      "The operation was aborted.",
      "AbortError",
    );
    openAiMocks.responsesParse.mockRejectedValue(abortError);

    await expect(requestStructuredOutput()).rejects.toBe(abortError);
  });

  it("propagates a timeout unchanged instead of calling it a capability failure", async () => {
    const timeoutError = new DOMException(
      "The operation timed out.",
      "TimeoutError",
    );
    openAiMocks.responsesParse.mockRejectedValue(timeoutError);

    await expect(requestStructuredOutput()).rejects.toBe(timeoutError);
  });

  it("keeps a rate limit as a plain upstream error, not a capability failure", async () => {
    openAiMocks.responsesParse.mockRejectedValue(
      Object.assign(new Error("429 Rate limit exceeded, retry shortly."), {
        status: 429,
      }),
    );

    const error: unknown = await requestStructuredOutput().then(
      () => {
        throw new Error("expected rejection");
      },
      (cause: unknown) => cause,
    );

    expect(error).toBeInstanceOf(UpstreamProviderError);
    expect((error as Error).message).toBe(
      "429 Rate limit exceeded, retry shortly.",
    );
  });

  it("labels a schema rejection as a structured output capability failure", async () => {
    openAiMocks.responsesParse.mockRejectedValue(
      Object.assign(
        new Error("404 No endpoints found that support response_format."),
        { status: 404 },
      ),
    );

    const request = requestStructuredOutput();
    await expect(request).rejects.toBeInstanceOf(UpstreamProviderError);
    await expect(request).rejects.toThrow(
      "OpenRouter model does not support the required structured graph output: 404 No endpoints found that support response_format.",
    );
  });

  it("labels a response that ignored the schema as a capability failure", async () => {
    openAiMocks.responsesParse.mockResolvedValue({
      output_parsed: null,
      output_text: "not json",
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    });

    const request = requestStructuredOutput();
    await expect(request).rejects.toBeInstanceOf(UpstreamProviderError);
    await expect(request).rejects.toThrow(
      "OpenRouter model does not support the required structured graph output: Structured output parsing returned no parsed payload.",
    );
  });
});
