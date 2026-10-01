import { AsyncLocalStorage } from "node:async_hooks";

type Metric = { name: string; duration: number; description?: "executed" | "shared" | "skipped" };
const storage = new AsyncLocalStorage<RequestTiming>();

export class RequestTiming {
  private readonly started = performance.now();
  private readonly metrics: Metric[] = [];
  private readonly stageStarts = new Map<string, number>();
  private preflightDuration = 0;
  private preflightState: "executed" | "shared" | "skipped" = "skipped";

  async measure<T>(name: string, work: () => Promise<T>): Promise<T> {
    const started = performance.now();
    try { return await work(); }
    finally { this.add(name, performance.now() - started); }
  }

  measureSync<T>(name: string, work: () => T): T {
    const started = performance.now();
    try { return work(); }
    finally { this.add(name, performance.now() - started); }
  }

  add(name: string, duration: number) {
    const existing = this.metrics.find(metric => metric.name === name);
    if (existing) existing.duration += Math.max(0, duration);
    else this.metrics.push({ name, duration: Math.max(0, duration) });
  }

  authStage = (stage: string) => {
    const name = stage.startsWith("session_lookup") ? "auth-session" : stage.startsWith("user_lookup") ? "role-user" : null;
    if (!name) return;
    if (stage.endsWith("_start")) this.stageStarts.set(name, performance.now());
    else if (stage.endsWith("_complete")) {
      const started = this.stageStarts.get(name);
      if (started !== undefined) this.add(name, performance.now() - started);
    }
  };

  dbCheck(state: "executed" | "shared" | "skipped", duration: number) {
    if (state === "executed" || (state === "shared" && this.preflightState === "skipped")) this.preflightState = state;
    this.add("db-ready", duration);
  }

  preflight(duration: number) {
    this.preflightDuration += Math.max(0, duration);
  }

  finish(response: Response): Response {
    const metrics = [
      { name: "db-preflight", duration: this.preflightDuration, description: this.preflightState },
      ...this.metrics,
      { name: "total", duration: performance.now() - this.started },
    ];
    response.headers.set("Server-Timing", metrics.map(({ name, duration, description }) =>
      `${name};dur=${Math.max(0, duration).toFixed(2)}${description ? `;desc="${description}"` : ""}`).join(", "));
    return response;
  }
}

export function withRequestTiming<T>(timing: RequestTiming, work: () => Promise<T>): Promise<T> {
  return storage.run(timing, work);
}

export function currentRequestTiming() {
  return storage.getStore();
}
