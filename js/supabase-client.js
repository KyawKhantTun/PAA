// ============================================================
//  js/supabase-client.js
//  Include this FIRST (before any other scripts) in every page.
//  Also include the Supabase CDN before this file:
//  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
// ============================================================

// ─── CONFIGURATION ───────────────────────────────────────────
// Replace these with your actual Supabase project values
// Dashboard → Project Settings → API
const SUPABASE_URL     = 'https://rfuvffajmaufoptgwtnd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJmdXZmZmFqbWF1Zm9wdGd3dG5kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3Nzk5NjQsImV4cCI6MjA5MzM1NTk2NH0.E7HVW6uDxctpepxzspvpYmutJRvxBSYMl1nZ9mCKt9s';

// Your Express backend URL (change to your deployed URL in production)
const API_BASE = 'http://learnarduinowithace-production.up.railway.app';

// ─── SUPABASE CLIENT ─────────────────────────────────────────
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession:    true,   // stores session in localStorage
    autoRefreshToken:  true,   // auto-refreshes JWT before expiry
    detectSessionInUrl: true,  // handles magic link / OAuth callbacks
  },
});

// ─── AUTH HELPERS ────────────────────────────────────────────

/**
 * Get the current session (null if not logged in)
 */
async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

/**
 * Get the current user's profile from the DB
 */
async function getCurrentProfile() {
  const session = await getSession();
  if (!session) return null;
  const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
  return data;
}

/**
 * Sign out and redirect to login
 */
async function signOut() {
  // Log the activity
  try {
    const session = await getSession();
    if (session) {
      await apiFetch('/api/auth/logout-activity', { method: 'POST' });
    }
  } catch (_) {}
  await supabase.auth.signOut();
  window.location.href = 'index.html';
}

// ─── API FETCH HELPER ─────────────────────────────────────────
/**
 * Authenticated fetch to our Express backend.
 * Automatically attaches the Supabase JWT.
 *
 * Usage:
 *   const data = await apiFetch('/api/admin/users')
 *   const result = await apiFetch('/api/progress', { method:'POST', body: { lesson_id:'proj1' } })
 */
async function apiFetch(path, options = {}) {
  const session = await getSession();
  const token   = session?.access_token;

  const res = await fetch(`${API_BASE}${path}`, {
    method:  options.method || 'GET',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': token ? `Bearer ${token}` : '',
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

// ─── PROGRESS HELPERS ─────────────────────────────────────────
/**
 * Update a lesson's progress percentage.
 * Call this when a student advances through a lesson or project.
 *
 * Usage:  await updateProgress('proj1', 'Light It Up', 50)
 */
async function updateProgress(lessonId, lessonName, progressPct) {
  return apiFetch('/api/progress', {
    method: 'POST',
    body:   { lesson_id: lessonId, lesson_name: lessonName, progress_pct: progressPct },
  });
}

/**
 * Submit a quiz score.
 *
 * Usage:
 *   await submitQuiz('proj1_q1', 'Light It Up Quiz', 2, 3, { q1:'B', q2:'A', q3:'C' })
 */
async function submitQuiz(quizId, quizName, score, maxScore, answers = {}) {
  return apiFetch('/api/quiz/submit', {
    method: 'POST',
    body:   { quiz_id: quizId, quiz_name: quizName, score, max_score: maxScore, answers },
  });
}

// ─── PASSWORD GENERATOR ──────────────────────────────────────
function generateTempPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
