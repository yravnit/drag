import { uuid, text, integer, timestamp, uniqueIndex, snakeCase } from "drizzle-orm/pg-core";
import { user } from "./auth";

/**
 * Persistent rate limiting table. Replaces the in-memory Map that doesn't
 * survive serverless cold starts on Vercel.
 *
 * Each row tracks a (user_id, action) pair with a rolling window.
 */
export const rateLimits = snakeCase.table(
  "rate_limits",
  {
    id: uuid().defaultRandom().primaryKey(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    action: text().notNull(), // e.g. "ingest-repository"
    count: integer().notNull().default(0),
    windowStart: timestamp({ withTimezone: true }).notNull(),
    windowEnd: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("rate_limits_user_action_idx").on(table.userId, table.action),
  ],
);

export type RateLimit = typeof rateLimits.$inferSelect;
export type NewRateLimit = typeof rateLimits.$inferInsert;
