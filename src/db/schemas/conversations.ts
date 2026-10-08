import { uuid, text, timestamp, index, integer, snakeCase } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { repositories } from "./repository";

export const conversations = snakeCase.table(
  "conversations",
  {
    id: uuid().defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    repositoryId: uuid("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    title: text("title"),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    // Thread ordering is per (user, repository) — the only list GET /api/conversations serves.
    sortOrder: integer().default(0).notNull(),
  },
  (table) => [
    index("conversations_user_id_idx").on(table.userId),
    index("conversations_repo_id_idx").on(table.repositoryId),
  ],
);

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
