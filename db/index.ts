import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export function getDb() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("Missing DATABASE_URL environment variable. Set it to your Supabase PostgreSQL connection string before running the app.");
  }

  const client = postgres(databaseUrl, { prepare: false });
  return drizzle(client, { schema });
}
