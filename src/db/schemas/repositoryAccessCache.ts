import { uuid, text, timestamp, index, snakeCase, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { repositories } from "./repository";

export const repositoryAccessCache = snakeCase.table(
  "repository_access_cache",
  {
    id: uuid().defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    repositoryId: uuid("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    hasAccess: boolean("has_access").notNull(),
    verifiedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("repo_access_user_id_repo_id_key").on(table.userId, table.repositoryId),
    index("repo_access_user_id_idx").on(table.userId),
  ],
);

export type RepositoryAccessCache = typeof repositoryAccessCache.$inferSelect;
export type NewRepositoryAccessCache = typeof repositoryAccessCache.$inferInsert;
