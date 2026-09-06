// Never inspect or attach the underlying error: database/parser errors can contain credentials.
export class AuthServiceError extends Error {
  constructor() { super("Authentication service unavailable"); this.name = "AuthServiceError"; }
}
export function authErrorResponse(context: { route: string; requestId: string; stage: string }, message: string) {
  console.error("Authentication request failed", { route: context.route, requestId: context.requestId, stage: context.stage, category: "authentication_service" });
  return Response.json({ error: message }, { status: 503, headers: {
    "Cache-Control": "no-store, no-cache, must-revalidate", Pragma: "no-cache", Expires: "0",
  } });
}
