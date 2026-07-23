import { drizzle } from 'drizzle-orm/neon-http';
import { serverEnv } from '@/data/serverEnv';
import { relations } from './relations';

export const db = drizzle(serverEnv.DATABASE_URL, { relations });