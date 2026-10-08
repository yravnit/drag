import { describe, it, expect } from "vitest";
import { relations } from "../relations";

describe("db relations", () => {
  it("exports a valid relations configuration for repositories, chunks, and repositoryFiles", () => {
    expect(relations).toBeDefined();
    expect(relations.repositories).toBeDefined();
    expect(relations.repositories.name).toBe("repositories");
    expect(relations.chunks).toBeDefined();
    expect(relations.chunks.name).toBe("chunks");
    expect(relations.repositoryFiles).toBeDefined();
    expect(relations.repositoryFiles.name).toBe("repositoryFiles");

    expect(relations.repositories.relations.chunks).toBeDefined();
    expect(relations.repositories.relations.files).toBeDefined();
    expect(relations.chunks.relations.repository).toBeDefined();
    expect(relations.repositoryFiles.relations.repository).toBeDefined();
  });
});
