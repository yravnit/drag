import { text, integer, timestamp, snakeCase } from "drizzle-orm/pg-core";

/**
 * Persistence for dynamically discovered and validated NVIDIA LLMs.
 * Tracks probe latency, availability status, and last checked/success timestamps.
 */
export const nvidiaModels = snakeCase.table("nvidia_models", {
  modelId: text().primaryKey(),
  status: text().notNull(), // "available" | "unavailable"
  latencyMs: integer(),
  lastCheckedAt: timestamp({ withTimezone: true }).notNull(),
  lastSuccessAt: timestamp({ withTimezone: true }),
  lastError: text(),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp({ withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export type NvidiaModel = typeof nvidiaModels.$inferSelect;
export type NewNvidiaModel = typeof nvidiaModels.$inferInsert;
