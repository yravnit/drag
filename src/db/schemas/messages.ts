import { uuid, text, timestamp, index, check, snakeCase, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { conversations } from "./conversations";

/**
 * The four lifecycle states an assistant message moves through. Enforced by a CHECK
 * constraint so a typo in a status write fails loudly instead of silently producing a row
 * the UI cannot interpret. `pending` is reserved for a message row inserted before the
 * stream opens; the UI treats it as not-yet-complete.
 */
export const MESSAGE_STATUSES = ["pending", "streaming", "completed", "failed"] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const messages = snakeCase.table(
  "messages",
  {
    id: uuid().defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // "user" | "assistant"
    content: text("content").notNull(),
    citations: jsonb("citations"),
    status: text("status").$type<MessageStatus>().notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("messages_conversation_id_idx").on(table.conversationId),
    check(
      "messages_status_check",
      sql`${table.status} in ('pending', 'streaming', 'completed', 'failed')`,
    ),
  ],
);

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
