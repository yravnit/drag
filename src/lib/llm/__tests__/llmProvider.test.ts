import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreate = vi.fn();
vi.mock("openai", () => {
  return {
    default: class {
      chat = {
        completions: {
          create: mockCreate,
        },
      };
    },
  };
});

vi.mock("@/data/serverEnv", () => ({
  serverEnv: {
    NVIDIA_API_KEY: "mock-key",
    LLM_BASE_URL: "https://mock.base.url/v1",
    LLM_MODEL: "mock-model",
  },
}));

import { NimLLMProvider } from "../llmProvider";

describe("NimLLMProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("generate calls OpenAI chat.completions.create and returns content", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "hello response" } }],
    });

    const provider = new NimLLMProvider();
    const result = await provider.generate({
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result).toBe("hello response");
    expect(mockCreate).toHaveBeenCalledWith({
      model: "mock-model",
      messages: [{ role: "user", content: "hi" }],
      temperature: 0.2,
      max_tokens: 2048,
      stream: false,
    });
  });

  it("stream calls OpenAI completions.create with stream: true and yields content", async () => {
    // Mock the async iterable returned when stream: true
    const asyncIterable = {
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: "hello " } }] };
        yield { choices: [{ delta: { content: "stream" } }] };
      },
    };

    mockCreate.mockResolvedValueOnce(asyncIterable);

    const provider = new NimLLMProvider();
    const stream = await provider.stream({
      messages: [{ role: "user", content: "hi" }],
    });

    const chunks: string[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["hello ", "stream"]);
    expect(mockCreate).toHaveBeenCalledWith({
      model: "mock-model",
      messages: [{ role: "user", content: "hi" }],
      temperature: 0.2,
      max_tokens: 2048,
      stream: true,
    });
  });

  it("generate wraps reasoning_content in <think> tags when both reasoning and content exist", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            reasoning_content: "analyzing query",
            content: "final answer",
          },
        },
      ],
    });

    const provider = new NimLLMProvider();
    const result = await provider.generate({
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result).toBe("<think>analyzing query</think>final answer");
  });

  it("stream wraps reasoning_content in <think>...</think> tags before yielding content", async () => {
    const asyncIterable = {
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { reasoning_content: "thinking step 1" } }] };
        yield { choices: [{ delta: { reasoning_content: " and step 2" } }] };
        yield { choices: [{ delta: { content: "Here is the answer" } }] };
      },
    };

    mockCreate.mockResolvedValueOnce(asyncIterable);

    const provider = new NimLLMProvider();
    const stream = await provider.stream({
      messages: [{ role: "user", content: "hi" }],
    });

    const chunks: string[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      "<think>",
      "thinking step 1",
      " and step 2",
      "</think>",
      "Here is the answer",
    ]);
  });
});
