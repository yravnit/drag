import { uuid, text, timestamp, index, snakeCase, jsonb } from "drizzle-orm/pg-core";
import { conversations } from "./conversations";

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
    status: text("status").notNull(), // "pending" | "streaming" | "completed" | "failed"
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("messages_conversation_id_idx").on(table.conversationId),
  ],
);

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
