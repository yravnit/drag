import { describe, it, expect } from "vitest";
import { extractThinking } from "../thinking";

describe("extractThinking", () => {
  it("returns null thinking and unmodified answer for standard text", () => {
    const text = "Here is the explanation of the Spring PetClinic controllers.";
    const result = extractThinking(text);
    expect(result.thinking).toBeNull();
    expect(result.answer).toBe(text);
  });

  it("handles empty or falsy strings gracefully", () => {
    expect(extractThinking("")).toEqual({ thinking: null, answer: "" });
  });

  it("parses <think>...</think> tags and returns separated thinking and answer", () => {
    const text = `<think>
Analyzing Spring Petclinic 3-layer architecture.
Controllers call services.
Services call repositories.
</think>
Here is the high-level component diagram.`;

    const result = extractThinking(text);
    expect(result.thinking).toBe(
      "Analyzing Spring Petclinic 3-layer architecture.\nControllers call services.\nServices call repositories.",
    );
    expect(result.answer).toBe("Here is the high-level component diagram.");
  });

  it("parses <thought>...</thought> tags", () => {
    const text = "<thought>Thinking about repositories.</thought>Here are the repositories.";
    const result = extractThinking(text);
    expect(result.thinking).toBe("Thinking about repositories.");
    expect(result.answer).toBe("Here are the repositories.");
  });

  it("handles streaming in-progress reasoning where <think> is unclosed", () => {
    const text = "<think>Analyzing PetRepository and VisitRepository...";
    const result = extractThinking(text);
    expect(result.thinking).toBe("Analyzing PetRepository and VisitRepository...");
    expect(result.answer).toBe("");
  });

  it("parses chain-of-thought concluding with 'Now produce final answer.'", () => {
    const text = `We need to produce a diagram of internal APIs in PetClinic.
Controllers call Service methods. Service calls Repository methods.
We'll cite relevant code.

Now produce final answer.Here’s a high-level component diagram that shows how the internal APIs interact.`;

    const result = extractThinking(text);
    expect(result.thinking).toBe(
      "We need to produce a diagram of internal APIs in PetClinic.\nControllers call Service methods. Service calls Repository methods.\nWe'll cite relevant code.",
    );
    expect(result.answer).toBe(
      "Here’s a high-level component diagram that shows how the internal APIs interact.",
    );
  });

  it("parses 'Now produce final answer.' on its own line", () => {
    const text = `We have code snippets: VisitController, ClinicServiceImpl.
Thus answer: Provide a Mermaid flowchart.

Now produce final answer.

Explanation of the diagram:
Presentation Layer receives requests.`;

    const result = extractThinking(text);
    expect(result.thinking).toBe(
      "We have code snippets: VisitController, ClinicServiceImpl.\nThus answer: Provide a Mermaid flowchart.",
    );
    expect(result.answer).toBe(
      "Explanation of the diagram:\nPresentation Layer receives requests.",
    );
  });
});
