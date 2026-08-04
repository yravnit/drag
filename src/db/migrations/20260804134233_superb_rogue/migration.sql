ALTER TABLE "repositories" ADD COLUMN "embedding_status" text;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "embedding_lease_expires_at" timestamp with time zone;