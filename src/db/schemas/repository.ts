import { uuid, text, timestamp, index, snakeCase } from "drizzle-orm/pg-core";

export const repositories = snakeCase.table(
  "repositories",
  {
    id: uuid().defaultRandom().primaryKey(),
    name: text().notNull(),
    owner: text().notNull(),
    url: text().notNull().unique(),
    defaultBranch: text().notNull(),
    description: text(),
    primaryLanguage: text(),
    headCommitSha: text(),
    indexedAt: timestamp({ withTimezone: true }),
    embeddingStatus: text(),
    embeddingLeaseExpiresAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    // Composite index for getRepositoryByOwnerAndName lookups
    index("repositories_owner_name_idx").on(table.owner, table.name),
  ],
);

export type Repository = typeof repositories.$inferSelect;
export type NewRepository = typeof repositories.$inferInsert;
