import { createClient } from "@supabase/supabase-js";

// Publishable key is designed to appear in browsers. Never use a secret/service_role key here.
export const SUPABASE_URL = "https://juiegqemecodojunlbcc.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_p0w8AeRjk0BeGISm5R9WTg_r1cvPSB2";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "pkce"
  }
});
