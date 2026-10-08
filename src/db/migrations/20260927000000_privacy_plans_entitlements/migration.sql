ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "plan" text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "custom_repository_limit" integer;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "custom_monthly_query_limit" integer;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "custom_repository_size_bytes" bigint;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "custom_file_limit" integer;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "custom_allowed_branch" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "custom_incremental_reindex_allowed" boolean;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN IF NOT EXISTS "is_private" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN IF NOT EXISTS "embedding_provider" text;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN IF NOT EXISTS "embedding_model" text;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN IF NOT EXISTS "embedding_dimensions" integer DEFAULT 768;--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN IF NOT EXISTS "embedding_provider" text;--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN IF NOT EXISTS "embedding_model" text;