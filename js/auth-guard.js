// ============================================================
//  js/auth-guard.js
//  Add to any page that requires a logged-in user.
//
//  USAGE — paste near the top of your <script> section:
//
//    // For student pages (any logged-in user):
//    const { session, profile } = await authGuard();
//
//    // For admin-only pages:
//    const { session, profile } = await adminGuard();
//
//  Requires supabase-client.js to be loaded first.
// ============================================================

/**
 * Ensure user is logged in.
 * Redirects to index.html if not.
 * Returns { session, profile } on success.
 */
async function authGuard() {
  const session = await getSession();

  if (!session) {
    // Not logged in — send to login page
    window.location.replace('index.html');
    return { session: null, profile: null };
  }

  // Update last_active in the background (non-blocking)
  supabase
    .from('profiles')
    .update({ last_active: new Date().toISOString() })
    .eq('id', session.user.id)
    .then(() => {});

  const profile = await getCurrentProfile();
  return { session, profile };
}

/**
 * Ensure user is logged in AND is an admin.
 * Redirects to arduino.html if not admin.
 * Redirects to index.html if not logged in.
 */
async function adminGuard() {
  const { session, profile } = await authGuard();
  if (!session) return { session: null, profile: null };

  if (!profile || profile.role !== 'admin') {
    window.location.replace('arduino.html');
    return { session: null, profile: null };
  }

  return { session, profile };
}

/**
 * Populate the account dropdown in the nav with real user data.
 * Call this on any page that has the nav account dropdown.
 *
 * @param {object} profile  — the profile object from authGuard()
 */
function populateNavAccount(profile) {
  if (!profile) return;

  // Name & email in dropdown header
  const nameEl  = document.getElementById('navAccName');
  const emailEl = document.getElementById('navAccEmail');
  const avEl    = document.getElementById('navAccAv');
  const bigAvEl = document.getElementById('navAccBigAv');

  if (nameEl)  nameEl.textContent  = profile.full_name || profile.username;
  if (emailEl) emailEl.textContent = profile.email;

  // Use first letter of name as avatar placeholder
  const letter = (profile.full_name || profile.username || '?').charAt(0).toUpperCase();
  if (avEl)    avEl.textContent    = letter;
  if (bigAvEl) bigAvEl.textContent = letter;

  // Show admin badge if admin
  const roleEl = document.getElementById('navAccRole');
  if (roleEl && profile.role === 'admin') {
    roleEl.textContent = '👑 Admin';
    roleEl.style.color = '#ffa726';
  }

  // Update progress bar in dropdown
  updateNavProgress(profile.id);
}

/**
 * Pull lesson progress and update the nav dropdown progress bar.
 */
async function updateNavProgress(userId) {
  try {
    const { data: progressRows } = await supabase
      .from('lesson_progress')
      .select('progress_pct')
      .eq('user_id', userId);

    const TOTAL_LESSONS = 50;
    const completed = (progressRows || []).filter(r => r.progress_pct >= 100).length;
    const pct = Math.round((completed / TOTAL_LESSONS) * 100);

    const barEl = document.getElementById('navProgressFill');
    const pctEl = document.getElementById('navProgressPct');
    const cntEl = document.getElementById('navProgressCount');

    if (barEl) barEl.style.width = pct + '%';
    if (pctEl) pctEl.textContent  = pct + '%';
    if (cntEl) cntEl.textContent  = `${completed} / ${TOTAL_LESSONS} lessons`;
  } catch (_) {}
}

/**
 * Wire up the account dropdown toggle and logout button.
 * Call this once per page.
 */
function initNavAccount(profile) {
  populateNavAccount(profile);

  // Toggle dropdown on button click
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-acc-toggle]');
    const dd  = document.getElementById('accountDropdown');
    if (!dd) return;
    if (btn) {
      dd.classList.toggle('open');
    } else if (!e.target.closest('#accountDropdown')) {
      dd.classList.remove('open');
    }
  });
}

/**
 * Logout function — called from the dropdown "Log Out" button.
 */
async function handleLogout() {
  if (!confirm('Log out?')) return;
  await signOut(); // defined in supabase-client.js
}
