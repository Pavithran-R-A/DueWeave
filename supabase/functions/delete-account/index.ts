// Arc 3C STEP 4 — `delete-account`: the only supported way for a DueWeave account holder to erase
// their own account.
//
// Everything that decides *whether* a request may proceed lives in ./contract.ts and is executed by
// tests/arc3c-erasure-contract.test.ts. What lives here is the wiring: read the request, ask GoTrue
// who the caller is, call the two privileged steps in order, and describe the outcome honestly.
//
// Three properties worth stating because they are the whole reason this is a function and not a
// client call:
//
//   1. The target is never taken from the request. It is `user.id` from a token GoTrue confirmed by
//      its own signature check. `delete_my_account()` also takes no argument, so the two halves of
//      this endpoint agree that a browser cannot name an account.
//   2. The business-data purge runs as the CALLER, on the caller's own token — not on the privileged
//      key. The RPC is revoked from `service_role` (20261006120000_current_arc3c_account_erasure_path.sql),
//      so a leaked server-side key is not, by itself, an erasure capability.
//   3. The privileged key exists only in this runtime's environment, which is injected by the
//      platform (`supabase secrets set`), never imported by the bundle and never echoed by a reply.
//
// The admin API removes the auth.users row only after the RPC has emptied every guarded table, which
// is what lets GoTrue's own cascade run without tripping the immutability triggers — B17 in one
// sentence. If that second step fails, the response says so and is not a success: the login still
// works and the records are gone, and the account holder is the only person who can retry.
//
// Deploy (owner action, not part of this build): `pnpm exec supabase functions deploy delete-account`
// after `supabase secrets set ALLOWED_APP_ORIGIN=https://<the app's exact origin>`. See
// docs/ACCOUNT_ERASURE_DESIGN.md for the full runbook and for why nothing was deployed here.

import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  ERASURE_RPC,
  INCOMPLETE_ERASURE_MESSAGE,
  authorizeMethod,
  bearerToken,
  erasureFailureMessage,
  parseConfirmation,
  requestOriginFor,
} from "./contract.ts";

function response(status: number, body: unknown, allowOrigin: string | null): Response {
  const headers = new Headers({ "content-type": "application/json" });
  // Only ever the configured origin, and only when there was a cross-origin conversation to have.
  if (allowOrigin) headers.set("access-control-allow-origin", allowOrigin);
  return new Response(JSON.stringify(body), { status, headers });
}

function failure(outcome: { status: number; message: string }, allowOrigin: string | null): Response {
  return response(outcome.status, { status: "error", message: outcome.message }, allowOrigin);
}

Deno.serve(async (request: Request) => {
  const configured = Deno.env.get("ALLOWED_APP_ORIGIN");
  const origin = requestOriginFor(request.headers.get("origin"), configured);
  if ("status" in origin) return failure(origin, null);

  if (request.method === "OPTIONS") {
    const headers = new Headers({
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-max-age": "600",
    });
    if (origin.origin) headers.set("access-control-allow-origin", origin.origin);
    return new Response(null, { status: 204, headers });
  }

  const method = authorizeMethod(request.method);
  if (method) return failure(method, origin.origin);

  const credential = bearerToken(request.headers.get("authorization"));
  if ("status" in credential) return failure(credential, origin.origin);

  let bodyText = "";
  try {
    bodyText = await request.text();
  } catch {
    return failure({ status: 400, message: "The deletion request could not be read." }, origin.origin);
  }
  const confirmation = parseConfirmation(bodyText);
  if (confirmation) return failure(confirmation, origin.origin);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const secretKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !secretKey) {
    // Names, never values, and only to whoever can already read the deployment's environment.
    return response(501, { status: "error", message: "Account deletion is not configured on this deployment." }, origin.origin);
  }

  // The caller's own client: every database step below runs with their authority and their
  // `auth.uid()`, which is what makes the erasure context unforgeable.
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${credential.token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: session, error: sessionError } = await caller.auth.getUser();
  if (sessionError || !session.user) {
    return failure({ status: 401, message: "Sign in before deleting your account." }, origin.origin);
  }

  const { error: purgeError } = await caller.rpc(ERASURE_RPC);
  if (purgeError) {
    return response(500, { status: "error", message: erasureFailureMessage(purgeError.message) }, origin.origin);
  }

  // Only the privileged client may reach GoTrue's admin route, and only ever for the id GoTrue
  // itself just returned.
  const privileged = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: accountError } = await privileged.auth.admin.deleteUser(session.user.id);
  if (accountError) {
    // No identifier, no cause: the account holder needs to know the state they are in, and the
    // platform log carries the stage for whoever can act on it.
    console.error("delete-account: purge succeeded, account removal failed");
    return response(500, { status: "incomplete", message: INCOMPLETE_ERASURE_MESSAGE }, origin.origin);
  }

  return response(200, { status: "deleted" }, origin.origin);
});
