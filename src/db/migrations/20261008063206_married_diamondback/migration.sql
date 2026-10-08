ALTER TABLE "user_repositories" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;