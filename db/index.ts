import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const DATABASE_UNAVAILABLE_MESSAGE = "Сервер түр ачаалалтай байна. Түр хүлээгээд дахин оролдоно уу.";
export const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};
type AppDb = ReturnType<typeof drizzle<typeof schema>>;
type PostgresClient = ReturnType<typeof postgres>;

const globalForDatabase = globalThis as typeof globalThis & {
  __greenEngineDb?: AppDb;
  __greenEnginePostgres?: PostgresClient;
};

export function getDb() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("Missing DATABASE_URL environment variable. Set it to your Supabase PostgreSQL connection string before running the app.");
  }

  if (!globalForDatabase.__greenEngineDb) {
    globalForDatabase.__greenEnginePostgres = postgres(databaseUrl, {
      prepare: false,
      max: 1,
      idle_timeout: 5,
      connect_timeout: 10,
    });
    globalForDatabase.__greenEngineDb = drizzle(globalForDatabase.__greenEnginePostgres, { schema });
  }

  return globalForDatabase.__greenEngineDb;
}

export function isDatabaseConnectionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /EMAXCONN|ECONN|connection|connect|timeout|timed out|failed query/i.test(message);
}

export function databaseErrorResponse(error: unknown, fallback: string) {
  console.error("Database request failed", error);
  return Response.json({ error: DATABASE_UNAVAILABLE_MESSAGE }, { status: 503, headers: NO_STORE_HEADERS });
}

export function safeErrorResponse(error: unknown, fallback: string, status = 500) {
  console.error("API request failed", error);
  return Response.json({ error: fallback }, { status, headers: NO_STORE_HEADERS });
}
