import {
  uuid,
  text,
  integer,
  timestamp,
  index,
  uniqueIndex,
  vector,
  snakeCase,
} from "drizzle-orm/pg-core";
import { repositories } from "./repository";

// Embedding dimension is fixed at 768 to match vector(768) in the migration SQL and HNSW index.
// Do not change without a corresponding DB migration and snapshot regeneration.
export const EMBEDDING_DIMENSIONS = 768;

export const chunks = snakeCase.table(
  "chunks",
  {
    id: uuid().defaultRandom().primaryKey(),
    repositoryId: uuid()
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    filePath: text().notNull(),
    language: text().notNull(),
    chunkType: text().notNull(),
    symbolName: text(),
    startLine: integer().notNull(),
    endLine: integer().notNull(),
    text: text().notNull(),
    embedding: vector({ dimensions: EMBEDDING_DIMENSIONS }),
    embeddingProvider: text("embedding_provider"),
    embeddingModel: text("embedding_model"),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("chunks_repository_id_idx").on(table.repositoryId),
    index("chunks_file_path_idx").on(table.filePath),
    // Duplicate protection constraint (Option A)
    uniqueIndex("chunks_repo_file_lines_idx").on(
      table.repositoryId,
      table.filePath,
      table.startLine,
      table.endLine,
    ),
    // HNSW pgvector index for fast semantic search cosine distance lookups
    index("chunks_embedding_hnsw_idx").using("hnsw", table.embedding.op("vector_cosine_ops")),
  ],
);

export type Chunk = typeof chunks.$inferSelect;
export type NewChunk = typeof chunks.$inferInsert;
