// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { ModelSelector } from "../ModelSelector";

const models = [
  { id: "meta/llama-3.3-70b", name: "llama-3.3-70b", latencyMs: 1420 },
  { id: "nvidia/nemotron-3-super", name: "nemotron-3-super", latencyMs: 310 },
  { id: "openai/gpt-oss-120b", name: "gpt-oss-120b", latencyMs: 890 },
];

let container: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

function mockModelsResponse(payload: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => payload }),
  );
}

async function mountSelector(onSelectModel: (id: string) => void) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <ModelSelector selectedModel="default" onSelectModel={onSelectModel} />,
    );
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  vi.unstubAllGlobals();
});

describe("model picker default", () => {
  it("selects the model with the lowest latency", async () => {
    mockModelsResponse({ models });
    const onSelectModel = vi.fn();
    await mountSelector(onSelectModel);

    expect(onSelectModel).toHaveBeenCalledTimes(1);
    expect(onSelectModel).toHaveBeenCalledWith("nvidia/nemotron-3-super");
  });

  it("keeps the configured default LLM when no model reports a latency", async () => {
    mockModelsResponse({
      models: [{ id: "meta/llama-3.3-70b", name: "llama-3.3-70b", latencyMs: null }],
    });
    const onSelectModel = vi.fn();
    await mountSelector(onSelectModel);

    expect(onSelectModel).not.toHaveBeenCalled();
  });

  it("ignores models without a latency when picking the fastest", async () => {
    mockModelsResponse({
      models: [
        { id: "vendor/unknown", name: "unknown", latencyMs: null },
        ...models,
      ],
    });
    const onSelectModel = vi.fn();
    await mountSelector(onSelectModel);

    expect(onSelectModel).toHaveBeenCalledWith("nvidia/nemotron-3-super");
  });
});