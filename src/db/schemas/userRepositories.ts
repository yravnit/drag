import { uuid, text, timestamp, index, integer, snakeCase, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { repositories } from "./repository";

export const userRepositories = snakeCase.table(
  "user_repositories",
  {
    id: uuid().defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    repositoryId: uuid("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    addedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    // Per-user ordering preference. A repositories row is shared between users (rows are keyed by
    // github_id), so the position lives on the association, not on repositories.
    sortOrder: integer().default(0).notNull(),
  },
  (table) => [
    uniqueIndex("user_repo_user_id_repo_id_key").on(table.userId, table.repositoryId),
    index("user_repo_user_id_idx").on(table.userId),
    index("user_repo_repo_id_idx").on(table.repositoryId),
  ],
);

export type UserRepository = typeof userRepositories.$inferSelect;
export type NewUserRepository = typeof userRepositories.$inferInsert;
