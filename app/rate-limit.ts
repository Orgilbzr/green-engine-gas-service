import { createHmac, randomUUID } from "node:crypto";
import { isIP } from "node:net";

const TIMEOUT_MS = 1000;
const WINDOW_MS = 10 * 60 * 1000;
const LIMITS = { "login-ip": 10, "login-account": 5 } as const;
type Limiter = keyof typeof LIMITS;
type Context = { route: string; requestId: string };
const MESSAGE = "Хэт олон удаа оролдлоо. Түр хүлээгээд дахин оролдоно уу.";

// Redis owns time and performs prune/check/reserve atomically across all instances.
// Unique members allow successful logins to refund only their own account attempt.
export const RESERVE_SCRIPT = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local window = tonumber(ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  return {0, math.max(1, math.ceil((tonumber(oldest[2]) + window - now) / 1000))}
end
redis.call('ZADD', KEYS[1], now, ARGV[3])
redis.call('PEXPIRE', KEYS[1], window)
return {1, 0}
`;

function configuration() {
  const endpoint = new URL(process.env.UPSTASH_REDIS_REST_URL || "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !token) throw new Error("Rate limit configuration unavailable");
  return { url: endpoint.toString(), token };
}

// Only trust Vercel's platform header when running behind Vercel. Never use a
// caller-controlled forwarded chain. Missing/invalid IPs share a conservative bucket.
export function clientIp(request: Request) {
  if (process.env.VERCEL !== "1") return "unknown";
  const value = request.headers.get("x-vercel-forwarded-for")?.trim() || "";
  const version = isIP(value);
  if (version === 4) return value;
  if (version === 6) return new URL(`http://[${value}]/`).hostname;
  return "unknown";
}

export function rateLimitKey(limiter: Limiter, identifier: string, secret: string) {
  const normalized = limiter === "login-account" ? identifier.trim().toLowerCase() : identifier;
  // HMAC prevents offline email/IP enumeration from a leaked key inventory.
  const digest = createHmac("sha256", secret).update(`${limiter}:${normalized}`).digest("hex");
  return `green-engine:rl:v1:${limiter}:${digest}`;
}

async function command(config: { url: string; token: string }, body: (string | number)[]) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Covers connection, response body and parsing, even if a transport ignores abort.
    return await Promise.race([
      (async () => {
        const response = await fetch(config.url, {
          method: "POST", headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
          body: JSON.stringify(body), cache: "no-store", redirect: "error", signal: controller.signal,
        });
        if (!response.ok) throw new Error("Rate limit backend unavailable");
        const data = await response.json();
        if (!data || data.error || !("result" in data)) throw new Error("Rate limit backend unavailable");
        return data.result as unknown;
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("Rate limit timeout")); }, TIMEOUT_MS);
      }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

function diagnostic(event: string, context: Context, limiter: Limiter, started: number) {
  console.info(event, { route: context.route, requestId: context.requestId, limiter, duration_ms: Date.now() - started });
}
function response(status: number, retryAfter: number) {
  return Response.json({ error: status === 429 ? MESSAGE : "Нэвтрэх боломжгүй байна. Түр хүлээгээд дахин оролдоно уу." }, {
    status, headers: { "Cache-Control": "no-store", "Retry-After": String(retryAfter) },
  });
}

export async function checkRateLimit(limiter: Limiter, identifier: string, context: Context): Promise<{ response: Response } | { release: () => Promise<void> }> {
  const started = Date.now();
  diagnostic("rate_limit_check", context, limiter, started);
  try {
    const config = configuration();
    const key = rateLimitKey(limiter, identifier, config.token);
    const member = randomUUID();
    const result = await command(config, ["EVAL", RESERVE_SCRIPT, 1, key, WINDOW_MS, LIMITS[limiter], member]);
    if (!Array.isArray(result) || result.length !== 2 || ![0, 1].includes(result[0]) || !Number.isInteger(result[1]) || result[1] < 0 || result[1] > 600) throw new Error("Invalid rate limit result");
    if (result[0] === 0) {
      diagnostic("rate_limit_blocked", context, limiter, started);
      return { response: response(429, Math.max(1, result[1])) };
    }
    diagnostic("rate_limit_allowed", context, limiter, started);
    return { release: async () => {
      const releaseStarted = Date.now();
      try {
        const removed = await command(config, ["ZREM", key, member]);
        if (removed !== 0 && removed !== 1) throw new Error("Invalid rate limit result");
      } catch {
        // Login already succeeded: retain the reservation until expiry if refund fails.
        diagnostic("rate_limit_backend_error", context, limiter, releaseStarted);
      }
    } };
  } catch {
    diagnostic("rate_limit_backend_error", context, limiter, started);
    // No memory fallback and no bypass on missing configuration or backend failure.
    return { response: response(503, 5) };
  }
}
