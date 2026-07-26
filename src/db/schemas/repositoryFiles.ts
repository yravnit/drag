import { pgTable, uuid, text, timestamp, uniqueIndex, snakeCase } from "drizzle-orm/pg-core";
import { repositories } from "./repository";

export const repositoryFiles = snakeCase.table(
  "repository_files",
  {
    id: uuid().defaultRandom().primaryKey(),
    repositoryId: uuid()
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    filePath: text().notNull(),
    contentHash: text().notNull(), // SHA-256 hash of file content
    sizeBytes: text(),
    indexedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("repo_files_repo_id_file_path_idx").on(table.repositoryId, table.filePath),
  ]
);

export type RepositoryFile = typeof repositoryFiles.$inferSelect;
export type NewRepositoryFile = typeof repositoryFiles.$inferInsert;
