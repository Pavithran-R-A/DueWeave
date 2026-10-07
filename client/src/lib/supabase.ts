import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.generated";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
// Supabase is retiring the legacy anon/service_role key model. Prefer the current publishable
// key in hosted builds, but keep the legacy variable as a local-development fallback while the
// pinned CLI still supports it.
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error("DueWeave needs its secure connection configured before it can open.");
}

export const supabase = createClient<Database>(supabaseUrl, supabasePublishableKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});
