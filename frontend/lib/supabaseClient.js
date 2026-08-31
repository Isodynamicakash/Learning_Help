import { createClient } from "@supabase/supabase-js";

// Uses the PUBLIC anon key only — safe for the browser. The service-role
// key lives exclusively in backend/.env and is never sent to the client.
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);
