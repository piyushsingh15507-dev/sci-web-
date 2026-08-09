// Shared Supabase client — used by every page.
// Loads the CDN library + your config.js values.
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------- helpers used across pages ----------
async function getCurrentProfile() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabaseClient
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();
  return profile;
}

async function requireLogin(redirectTo = '../login.html') {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    window.location.href = redirectTo;
    return null;
  }
  return session;
}

async function requireAdmin(redirectTo = '../login.html') {
  const session = await requireLogin(redirectTo);
  if (!session) return null;
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== 'admin') {
    alert('Admin access only.');
    window.location.href = redirectTo;
    return null;
  }
  return profile;
}

async function logout(redirectTo = '../login.html') {
  await supabaseClient.auth.signOut();
  window.location.href = redirectTo;
}
