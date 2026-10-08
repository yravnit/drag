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
  MESSAGE_STATUSES,
} from "../schema";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

/** Renders a CHECK constraint's SQL expression to a string via drizzle's own Postgres dialect. */
function compileCheck(value: SQL): string {
  return new PgDialect().sqlToQuery(value).sql;
}

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
      expect(messages.attemptId).toBeDefined();
    });

    it("defines a persisted sort_order on user_repositories and conversations", () => {
      // Both lists are drag-reorderable, so the position must survive a reload. Defaulting to 0
      // means every row that predates the column still orders, and `notNull` keeps the tiebreak
      // on id the only thing that has to break a tie.
      for (const table of [userRepositories, conversations]) {
        expect(table.sortOrder).toBeDefined();
        expect(table.sortOrder.notNull).toBe(true);
        expect(table.sortOrder.default).toBe(0);
        // snakeCase.table maps the camelCase property onto the snake_case column.
        expect(table.sortOrder.name).toBe("sort_order");
      }
    });

    it("keys repository ordering on the association, not on the shared repositories row", () => {
      // repositories rows are shared between users (keyed by github_id), so a sort_order there
      // would be one user's preference applied to everybody.
      expect(repositories).not.toHaveProperty("sortOrder");
      expect(getTableConfig(userRepositories).columns.map((c) => c.name)).toContain("sort_order");
    });

    it("constrains messages.status to the four known lifecycle values", () => {
      const config = getTableConfig(messages);
      const statusCheck = config.checks.find((c) => c.name === "messages_status_check");
      expect(statusCheck).toBeDefined();

      // Compiling to SQL is the real assertion: the generated statement must test membership
      // of exactly these four values. Inspecting queryChunks instead would couple the test to
      // drizzle's internal chunk shape.
      const compiled = compileCheck(statusCheck!.value);
      for (const value of MESSAGE_STATUSES) {
        expect(compiled).toContain(`'${value}'`);
      }
      // Four literals, three "or" joins: a set test rather than a loose prefix match.
      expect(compiled.match(/'pending'|'streaming'|'completed'|'failed'/g)).toHaveLength(4);
    });
  });
});
