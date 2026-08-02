import { uuid, text, timestamp, snakeCase } from "drizzle-orm/pg-core";

export const repositories = snakeCase.table("repositories", {
  id: uuid().defaultRandom().primaryKey(),
  name: text().notNull(),
  owner: text().notNull(),
  url: text().notNull().unique(),
  defaultBranch: text().notNull(),
  description: text(),
  primaryLanguage: text(),
  headCommitSha: text(),
  indexedAt: timestamp({ withTimezone: true }),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp({ withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export type Repository = typeof repositories.$inferSelect;
export type NewRepository = typeof repositories.$inferInsert;
