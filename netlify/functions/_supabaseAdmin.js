const { createClient } = require('@supabase/supabase-js');

// Service-role client - bypasses RLS. Only ever used server-side in these
// functions, never shipped to the browser. Requires SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY to be set as Netlify environment variables.
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// Verifies the Supabase access token a logged-in user sends from the frontend
// (Authorization: Bearer <token>) and returns their user id, or null if invalid.
async function getUserIdFromRequest(event) {
  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user.id;
}

module.exports = { supabaseAdmin, getUserIdFromRequest };
