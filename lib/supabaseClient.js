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

// Checks the maintenance_mode flag (does NOT redirect — caller decides what to do with the result).
async function isMaintenanceOn(profile) {
  if (profile && profile.role === 'admin') return false; // admins always bypass
  const { data } = await supabaseClient.from('app_settings').select('maintenance_mode').eq('id', 1).single();
  return !!(data && data.maintenance_mode);
}

// Builds (once) and shows/hides a full-screen "503" overlay directly on the current page —
// no navigation to a separate file, so it can appear/disappear live without reloading.
function ensureMaintenanceOverlay(){
  if (document.getElementById('maintenance-overlay')) return;
  const div = document.createElement('div');
  div.id = 'maintenance-overlay';
  div.style.cssText = 'display:none;position:fixed;inset:0;z-index:9999;background:#fafafa;align-items:center;justify-content:center;padding:24px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;';
  div.innerHTML = `
    <div style="max-width:480px;text-align:center;">
      <div style="font-size:56px;margin-bottom:18px;opacity:0.55;">⚠️</div>
      <h1 style="font-size:22px;font-weight:500;margin-bottom:10px;color:#202124;">503 Service Temporarily Unavailable</h1>
      <p style="font-size:14px;line-height:1.6;color:#5f6368;margin-bottom:6px;">The server is currently unable to handle this request due to scheduled maintenance.</p>
      <p style="font-size:14px;line-height:1.6;color:#5f6368;margin-bottom:6px;">Please try again in a little while.</p>
      <div style="font-size:12px;color:#9aa0a6;margin-top:28px;font-family:monospace;letter-spacing:.03em;">Error 503 — Service Unavailable</div>
    </div>
  `;
  document.body.appendChild(div);
}
function showMaintenanceOverlay(){
  ensureMaintenanceOverlay();
  document.getElementById('maintenance-overlay').style.display = 'flex';
}
function hideMaintenanceOverlay(){
  const el = document.getElementById('maintenance-overlay');
  if (el) el.style.display = 'none';
}

// Polls the flag every `intervalMs` and shows/hides the overlay live — used on pages where it's
// safe to interrupt at any moment (e.g. the dashboard). Not used mid-exam so an active timed test
// is never yanked away from a student.
let _maintenancePoll = null;
function startMaintenancePolling(profile, intervalMs = 15000){
  stopMaintenancePolling();
  const check = async () => { (await isMaintenanceOn(profile)) ? showMaintenanceOverlay() : hideMaintenanceOverlay(); };
  check();
  _maintenancePoll = setInterval(check, intervalMs);
}
function stopMaintenancePolling(){
  if (_maintenancePoll) { clearInterval(_maintenancePoll); _maintenancePoll = null; }
}
