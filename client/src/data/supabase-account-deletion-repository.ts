// Arc 3C STEP 5 — the browser's only route to account erasure: ask the `delete-account` Edge Function.
//
// Everything this seam deliberately does *not* do is load-bearing:
//
//   - It sends no bearer value of its own. The Supabase client puts the session's current, refreshed
//     access token on the request by itself (measured in supabase-js 2.112.3: the functions fetch
//     wrapper only fills the slot when the caller left it empty), so the function sees the person who
//     is signed in — which is what makes the erasure context unforgeable at the database.
//   - It sends one field, the confirmation. There is no user id to send, and adding one would create a
//     second, browser-controlled source for the target the endpoint is built to refuse.
//   - It does not read the ledger back. After a deletion the token is dead, so a re-read would fail and
//     its failure would look like the deletion had failed.
//
// The reply is mapped through `interpretDeletionReply` rather than returned, so no caller of this seam
// ever sees a raw status code or a body string it might decide to display.

import { supabase } from "@/lib/supabase";
import { ACCOUNT_DELETION_CONFIRMATION, interpretDeletionReply, type DeletionOutcome } from "@/lib/account-deletion";

const DELETE_ACCOUNT_FUNCTION = "delete-account";

export class SupabaseAccountDeletionRepository {
  async erase(): Promise<DeletionOutcome> {
    const { data, error, response } = await supabase.functions.invoke(DELETE_ACCOUNT_FUNCTION, {
      body: { confirm: ACCOUNT_DELETION_CONFIRMATION },
    });
    // Measured in @supabase/functions-js 2.112.3: a non-2xx leaves the Response unread and hands it
    // back as `error.context`, so the function's structured status is still readable there; a 2xx has
    // already been parsed into `data`. No reply at all — an offline browser, or a session the client
    // could not attach — is the one case where there is no status to read.
    const status = response ? response.status : null;
    const body = error ? await unreadJson(response) : data;
    return interpretDeletionReply({ status, body });
  }
}

async function unreadJson(response: Response | undefined): Promise<unknown> {
  if (!response) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}
