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

// Checks the maintenance_mode flag. If it's on and this user isn't an admin,
// redirects them to the maintenance page and returns true (caller should stop rendering).
async function checkMaintenanceMode(profile, maintenancePagePath = '../maintenance.html') {
  if (profile && profile.role === 'admin') return false; // admins always bypass
  const { data } = await supabaseClient.from('app_settings').select('maintenance_mode').eq('id', 1).single();
  if (data && data.maintenance_mode) {
    window.location.href = maintenancePagePath;
    return true;
  }
  return false;
}
