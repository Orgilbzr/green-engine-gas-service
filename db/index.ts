import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { getPostgresError } from "./booking-capacity";

export const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};
export function createRequestDiagnostics(route: string) {
  const requestId = crypto.randomUUID().slice(0, 8);
  const startedAt = Date.now();
  return {
    requestId,
    stage(stage: string) {
      console.info("[api-stage]", { route, requestId, stage, duration_ms: Date.now() - startedAt });
    },
  };
}
export function logSlowOperation(route: string, startedAt: number, status: number, timeoutCategory?: string) {
  const durationMs = Date.now() - startedAt;
  if (durationMs >= 1000 || timeoutCategory) console.warn("[api-timing]", { route, duration_ms: durationMs, status, timeout_category: timeoutCategory || "none" });
}
type AppDb = ReturnType<typeof drizzle<typeof schema>>;
type PostgresClient = ReturnType<typeof postgres>;
type DbBundle = { client: PostgresClient; db: AppDb };

const globalForDatabase = globalThis as typeof globalThis & {
  __greenEngineBundle?: DbBundle;
  __greenEngineRecycle?: Promise<DbBundle>;
  __greenEngineLastActivity?: number;
};

const DB_IDLE_PREFLIGHT_MS = 5000;
const DB_PREFLIGHT_TIMEOUT_MS = 2000;

function createDbBundle(): DbBundle {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("Missing DATABASE_URL environment variable. Set it to your Supabase PostgreSQL connection string before running the app.");
  }

  const client = postgres(databaseUrl, {
      prepare: false,
      max: 1,
      idle_timeout: 1,
      connect_timeout: 10,
      connection: { statement_timeout: 10000, lock_timeout: 10000 },
  });
  return { client, db: drizzle(client, { schema }) };
}

function currentDbBundle() {
  if (!globalForDatabase.__greenEngineBundle) globalForDatabase.__greenEngineBundle = createDbBundle();
  return globalForDatabase.__greenEngineBundle;
}

function logDbHealth(stage: string, durationMs?: number) {
  console.info("[db-health]", { stage, ...(durationMs === undefined ? {} : { duration_ms: durationMs }) });
}

async function preflight(bundle: DbBundle) {
  const startedAt = Date.now();
  logDbHealth("preflight_start");
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const query = bundle.client`SELECT 1`.then(() => {
    if (timeoutId) clearTimeout(timeoutId);
    logDbHealth("preflight_ok", Date.now() - startedAt);
  });
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new DbHealthError("preflight_timeout")), DB_PREFLIGHT_TIMEOUT_MS);
  });
  try {
    await Promise.race([query, timeout]);
  } catch (error) {
    query.catch(() => undefined);
    throw error;
  }
}

class DbHealthError extends Error {
  constructor(public readonly stage: string) {
    super(stage);
    this.name = "DbHealthError";
  }
}

async function recycleDbBundle(oldBundle: DbBundle) {
  logDbHealth("client_recycle");
  try {
    await oldBundle.client.end({ timeout: 0.1 });
  } catch {
    // The old client may already be broken; replacement must still proceed.
  }
  const replacement = createDbBundle();
  try {
    await preflight(replacement);
  } catch (error) {
    try {
      await replacement.client.end({ timeout: 0.1 });
    } catch {
      // Cleanup failure must not hide the availability error.
    }
    throw error;
  }
  globalForDatabase.__greenEngineBundle = replacement;
  globalForDatabase.__greenEngineLastActivity = Date.now();
  logDbHealth("replacement_ok");
  return replacement;
}

export async function getHealthyDb() {
  const bundle = currentDbBundle();
  const lastActivity = globalForDatabase.__greenEngineLastActivity ?? 0;
  if (Date.now() - lastActivity <= DB_IDLE_PREFLIGHT_MS) return bundle.db;

  if (!globalForDatabase.__greenEngineRecycle) {
    globalForDatabase.__greenEngineRecycle = (async () => {
      const current = currentDbBundle();
      try {
        await preflight(current);
        globalForDatabase.__greenEngineLastActivity = Date.now();
        return current;
      } catch {
        return recycleDbBundle(current);
      } finally {
        globalForDatabase.__greenEngineRecycle = undefined;
      }
    })();
  }
  return (await globalForDatabase.__greenEngineRecycle).db;
}

export function getDb() {
  return currentDbBundle().db;
}

export function isDbHealthError(error: unknown) {
  return error instanceof DbHealthError;
}


export function isDatabaseConnectionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return error instanceof DbHealthError || /EMAXCONN|ECONN|connection|connect|timeout|timed out/i.test(message);
}

export function databaseErrorResponse(error: unknown, fallback: string, context?: { route: string; requestId: string; stage: string }) {
  logDatabaseError(error, context || { route: "unknown", requestId: "unknown", stage: "response" });
  return Response.json({ error: "Систем түр ачаалалтай байна. Дахин оролдоно уу." }, { status: 503, headers: NO_STORE_HEADERS });
}

export function safeErrorResponse(error: unknown, fallback: string, status = 500, context?: { route: string; requestId: string; stage: string }) {
  if (getPostgresError(error) || isDatabaseConnectionError(error)) {
    logDatabaseError(error, context || { route: "unknown", requestId: "unknown", stage: "response" });
  } else {
    console.error("API request failed", error);
  }
  const connectionFailure = isDatabaseConnectionError(error);
  return Response.json({ error: connectionFailure ? "Систем түр ачаалалтай байна. Дахин оролдоно уу." : fallback }, { status: connectionFailure ? 503 : status, headers: NO_STORE_HEADERS });
}

export function logDatabaseError(error: unknown, context: { route: string; requestId: string; stage: string }) {
  const databaseError = getPostgresError(error);
  console.error("Database request failed", {
    route: context.route,
    requestId: context.requestId,
    sqlstate: databaseError?.code,
    constraint: databaseError?.constraint,
    stage: context.stage,
  });
}
