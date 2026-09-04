import { auditLogs } from "../db/schema";
import { getAppUser } from "./authz";

type AuditDatabase = any;
type AuditActor = Awaited<ReturnType<typeof getAppUser>>;

const sensitiveKey = /password|token|secret|cookie|database_url|admin_password|env/i;

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !sensitiveKey.test(key)).map(([key, item]) => [key, sanitize(item)]));
}

export function createChangeSet<T extends Record<string, unknown>>(before: T, after: T, fields: (keyof T)[]) {
  return Object.fromEntries(fields.flatMap((field) => before[field] === after[field] ? [] : [[field, { from: before[field], to: after[field] }]]));
}

export async function writeAuditLog(input: {
  db: AuditDatabase;
  actor?: AuditActor | null;
  action: string;
  entityType: string;
  entityId?: number | null;
  entityRef?: string | null;
  details?: unknown;
}) {
  const actor = input.actor === undefined ? await getAppUser() : input.actor;
  const values = {
    actorUserId: actor?.id ?? null,
    actorEmail: actor?.email ?? "public",
    actorRole: actor?.role ?? "public",
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    entityRef: input.entityRef ?? null,
    details: sanitize(input.details ?? {}),
  };
  await input.db.insert(auditLogs).values(values);
}