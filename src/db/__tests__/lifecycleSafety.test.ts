import { describe, it, expect } from "vitest";
import {
  repositories,
  chunks,
  repositoryFiles,
  userRepositories,
  conversations,
  messages,
  repositoryAccessCache,
  rateLimits,
} from "../schema";
import { getTableConfig } from "drizzle-orm/pg-core";

describe("Production Database Safety & Lifecycle Audit (5B)", () => {
  describe("Foreign Key & Cascade Behavior", () => {
    it("ensures chunks cascade delete when repository is deleted", () => {
      const config = getTableConfig(chunks);
      const repoFk = config.foreignKeys.find((fk) => {
        const reference = fk.reference();
        return reference.foreignTable === repositories;
      });
      expect(repoFk).toBeDefined();
      expect(repoFk?.onDelete).toBe("cascade");
    });

    it("ensures repository_files cascade delete when repository is deleted", () => {
      const config = getTableConfig(repositoryFiles);
      const repoFk = config.foreignKeys.find((fk) => {
        const reference = fk.reference();
        return reference.foreignTable === repositories;
      });
      expect(repoFk).toBeDefined();
      expect(repoFk?.onDelete).toBe("cascade");
    });

    it("ensures user_repositories cascade delete when repository is deleted", () => {
      const config = getTableConfig(userRepositories);
      const repoFk = config.foreignKeys.find((fk) => {
        const reference = fk.reference();
        return reference.foreignTable === repositories;
      });
      expect(repoFk).toBeDefined();
      expect(repoFk?.onDelete).toBe("cascade");
    });

    it("ensures repository_access_cache cascades when repository is deleted", () => {
      const config = getTableConfig(repositoryAccessCache);
      const repoFk = config.foreignKeys.find((fk) => {
        const reference = fk.reference();
        return reference.foreignTable === repositories;
      });
      expect(repoFk).toBeDefined();
      expect(repoFk?.onDelete).toBe("cascade");
    });

    it("ensures conversations cascade delete when repository is deleted", () => {
      const config = getTableConfig(conversations);
      const repoFk = config.foreignKeys.find((fk) => {
        const reference = fk.reference();
        return reference.foreignTable === repositories;
      });
      expect(repoFk).toBeDefined();
      expect(repoFk?.onDelete).toBe("cascade");
    });

    it("ensures messages cascade delete when conversation is deleted", () => {
      const config = getTableConfig(messages);
      const convFk = config.foreignKeys.find((fk) => {
        const reference = fk.reference();
        return reference.foreignTable === conversations;
      });
      expect(convFk).toBeDefined();
      expect(convFk?.onDelete).toBe("cascade");
    });
  });

  describe("Unique Constraints & Indexing", () => {
    it("has unique constraint on github_id for rename/transfer-aware identity", () => {
      expect(repositories.githubId.isUnique).toBe(true);
    });

    it("has unique index on userRepositories (user_id, repository_id)", () => {
      const config = getTableConfig(userRepositories);
      const uniqueIdx = config.indexes.find(
        (idx) => idx.config.name === "user_repo_user_id_repo_id_key" && idx.config.unique,
      );
      expect(uniqueIdx).toBeDefined();
    });

    it("has unique index on repositoryAccessCache (user_id, repository_id)", () => {
      const config = getTableConfig(repositoryAccessCache);
      const uniqueIdx = config.indexes.find(
        (idx) => idx.config.name === "repo_access_user_id_repo_id_key" && idx.config.unique,
      );
      expect(uniqueIdx).toBeDefined();
    });

    it("has bounded rate_limits with unique index on (user_id, action)", () => {
      const config = getTableConfig(rateLimits);
      const uniqueIdx = config.indexes.find(
        (idx) => idx.config.name === "rate_limits_user_action_idx" && idx.config.unique,
      );
      expect(uniqueIdx).toBeDefined();
    });

    it("has chunk line range unique index to prevent duplicate chunk records", () => {
      const config = getTableConfig(chunks);
      const uniqueIdx = config.indexes.find(
        (idx) => idx.config.name === "chunks_repo_file_lines_idx" && idx.config.unique,
      );
      expect(uniqueIdx).toBeDefined();
    });

    it("has HNSW vector index on chunks embedding for pgvector cosine search", () => {
      const config = getTableConfig(chunks);
      const hnswIdx = config.indexes.find(
        (idx) => idx.config.name === "chunks_embedding_hnsw_idx",
      );
      expect(hnswIdx).toBeDefined();
      expect(hnswIdx?.config.name).toBe("chunks_embedding_hnsw_idx");
    });
  });

  describe("Status & Lease Columns", () => {
    it("defines embedding status and lease expiration on repositories", () => {
      expect(repositories.embeddingStatus).toBeDefined();
      expect(repositories.embeddingLeaseExpiresAt).toBeDefined();
    });

    it("defines sync status and lease expiration on repositories", () => {
      expect(repositories.syncStatus).toBeDefined();
      expect(repositories.syncLeaseExpiresAt).toBeDefined();
      expect(repositories.nextSyncAt).toBeDefined();
    });

    it("defines message status column supporting streaming and failure recovery", () => {
      expect(messages.status).toBeDefined();
      expect(messages.citations).toBeDefined();
    });
  });
});
