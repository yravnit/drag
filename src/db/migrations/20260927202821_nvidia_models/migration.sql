CREATE TABLE IF NOT EXISTS "nvidia_models" (
	"model_id" text PRIMARY KEY,
	"status" text NOT NULL,
	"latency_ms" integer,
	"last_checked_at" timestamp with time zone NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
