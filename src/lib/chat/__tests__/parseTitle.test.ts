import { describe, it, expect } from "vitest";
import { parseTitle } from "../conversation";

/**
 * The model is asked for `{"title":"..."}` but is not trusted to emit it, so the parser walks four
 * fallbacks. Every one of these shapes is something a chat model actually returns.
 */
describe("parseTitle", () => {
  it("reads clean JSON", () => {
    expect(parseTitle('{"title":"Leasing service overview"}')).toBe("Leasing service overview");
  });

  it("reads JSON fenced in a code block", () => {
    expect(parseTitle('```json\n{"title":"Retry backoff logic"}\n```')).toBe(
      "Retry backoff logic",
    );
  });

  it("digs JSON out of surrounding prose", () => {
    expect(parseTitle('Sure! Here you go:\n{"title":"Auth flow"} \nHope that helps.')).toBe(
      "Auth flow",
    );
  });

  it("falls back to a regex when the JSON is malformed", () => {
    expect(parseTitle('{"title": Chunking strategy,}')).toBe("Chunking strategy");
  });

  it("falls back to a bare line of prose", () => {
    expect(parseTitle("How does the retry path work?")).toBe("How does the retry path work");
  });

  it("collapses whitespace, strips wrapping quotes and trailing punctuation", () => {
    // Built via stringify so the inner quotes are escaped and the payload is valid JSON.
    expect(parseTitle(JSON.stringify({ title: '  "Database   schema."  ' }))).toBe(
      "Database schema",
    );
  });

  it("clips an over-long title on a word boundary", () => {
    const source = "explanation of the ingestion workflow and chunking strategy".repeat(3);
    const title = parseTitle(JSON.stringify({ title: source }));
    expect(title).not.toBeNull();
    expect(title!.length).toBeLessThanOrEqual(60);
    // A word-boundary clip means the result is a clean prefix of the source, not a sliced word.
    expect(source.startsWith(title!) || source.startsWith(`${title!} `)).toBe(true);
  });

  it("returns null when there is nothing usable", () => {
    expect(parseTitle("")).toBeNull();
    expect(parseTitle("   \n  ")).toBeNull();
    expect(parseTitle('{"other":"value"}')).toBeNull();
    expect(parseTitle('{"title":""}')).toBeNull();
    expect(parseTitle('{"title":"   "}')).toBeNull();
  });
});