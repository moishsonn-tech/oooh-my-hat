// AI-Artist Intelligence — Supabase project config.
//
// Placeholders on purpose: nothing in this repo talks to Supabase until these
// are replaced with a real project's values (Project Settings → API). The
// anon key is safe to expose in client code — it's public by design, real
// protection comes from the RLS policies in supabase/schema.sql.
//
// Until real values are here, auth-gate.js treats the app as unconfigured
// and every page behaves exactly as it does today (open, single-tenant) —
// filling these in is the only step needed to switch the app into
// self-serve multi-artist mode.
window.SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
window.SUPABASE_ANON_KEY = 'YOUR-ANON-KEY';
