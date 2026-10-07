import { uuid, text, timestamp, index, snakeCase, bigint, boolean, integer } from "drizzle-orm/pg-core";

export const repositories = snakeCase.table(
  "repositories",
  {
    id: uuid().defaultRandom().primaryKey(),
    githubId: bigint("github_id", { mode: "bigint" }).unique(),
    name: text().notNull(),
    owner: text().notNull(),
    url: text().notNull().unique(),
    defaultBranch: text().notNull(),
    description: text(),
    primaryLanguage: text(),
    headCommitSha: text(),
    isPrivate: boolean("is_private").default(false).notNull(),
    embeddingProvider: text("embedding_provider"),
    embeddingModel: text("embedding_model"),
    embeddingDimensions: integer("embedding_dimensions").default(768),
    indexedAt: timestamp({ withTimezone: true }),
    embeddingStatus: text(),
    embeddingLeaseExpiresAt: timestamp({ withTimezone: true }),
    // Identifies the worker holding the embedding lease. A run can outlive the 10-minute lease,
    // so final writes require a matching claim id instead of trusting the lease alone.
    embeddingClaimId: text("embedding_claim_id"),
    nextSyncAt: timestamp({ withTimezone: true }),
    syncStatus: text(),
    syncLeaseExpiresAt: timestamp({ withTimezone: true }),
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
