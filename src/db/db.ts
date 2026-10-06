import { drizzle } from "drizzle-orm/neon-serverless";
import { serverEnv } from "@/data/serverEnv";
import { relations } from "./relations";

export const db = drizzle(serverEnv.DATABASE_URL, { relations });

export type Database = typeof db;
