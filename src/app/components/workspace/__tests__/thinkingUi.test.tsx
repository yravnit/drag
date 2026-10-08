import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ThinkingBlock } from "../ThinkingBlock";
import { MessageRenderer } from "../MessageRenderer";
import { PlanUsageModal } from "../PlanUsageModal";
import type { PlanUsageData } from "../types";

describe("Thinking indicator and Plan Card UI updates", () => {
  describe("ThinkingBlock", () => {
    it("renders a single line named 'Thinking' with linear shimmer class when completed", () => {
      const html = renderToStaticMarkup(
        <ThinkingBlock
          thinking="We need to produce a diagram..."
          isStreaming={false}
          hasAnswer={true}
        />,
      );

      expect(html).toContain("Thinking");
      expect(html).toContain("thinking-linear-shimmer");
      expect(html).toContain("button");
      expect(html).not.toContain("We need to produce a diagram...");
    });

    it("renders 'Thinking...' when streaming without an answer", () => {
      const html = renderToStaticMarkup(
        <ThinkingBlock
          thinking="Analyzing repository architecture..."
          isStreaming={true}
          hasAnswer={false}
        />,
      );

      expect(html).toContain("Thinking...");
      expect(html).toContain("thinking-linear-shimmer");
    });
  });

  describe("MessageRenderer with thinking", () => {
    it("renders thinking indicator alongside the answer", () => {
      const content = `<think>
Analyzing Spring Petclinic controllers.
</think>
Here is the component diagram.`;

      const html = renderToStaticMarkup(
        <MessageRenderer content={content} citations={[]} onCitationClick={vi.fn()} />,
      );

      expect(html).toContain("Thinking");
      expect(html).toContain("thinking-linear-shimmer");
      expect(html).toContain("Here is the component diagram.");
      expect(html).not.toContain("&lt;think&gt;");
    });

    it("handles petclinic transition 'Now produce final answer.'", () => {
      const content = `We have code snippets: VisitController.
Now produce final answer.Here is the diagram of internal APIs.`;

      const html = renderToStaticMarkup(
        <MessageRenderer content={content} citations={[]} onCitationClick={vi.fn()} />,
      );

      expect(html).toContain("Thinking");
      expect(html).toContain("thinking-linear-shimmer");
      expect(html).toContain("Here is the diagram of internal APIs.");
      expect(html).not.toContain("Now produce final answer.");
    });
  });

  describe("PlanUsageModal updates", () => {
    const mockPlanUsage: PlanUsageData = {
      plan: "free",
      pricing: {
        amount: "0",
        cadence: "month",
        currency: "INR",
        displayPrice: "₹0",
        description: "Free plan",
      },
      entitlements: {
        plan: "free",
        repositoryLimit: 2,
        monthlyQueryLimit: 25,
        repositorySizeLimitBytes: 50 * 1024 * 1024,
        fileLimit: 2500,
        allowedBranch: "main",
        incrementalReindexAllowed: false,
      },
      usage: {
        repositoriesCount: 1,
        monthlyQueriesCount: 5,
        monthlyQueriesResetAt: Date.now() + 86400000,
      },
    };

    it("renders Enterprise price as ₹15,000* without 'Starting from'", () => {
      const html = renderToStaticMarkup(
        <PlanUsageModal isOpen={true} onClose={vi.fn()} planUsage={mockPlanUsage} />,
      );

      expect(html).toContain("₹15,000*");
      expect(html).not.toContain("Starting from");
      expect(html).toContain("*Contact sales for custom pricing");
    });
  });
});
