// ============================================================
//  Logo Arduino Platform — Express Backend
//  npm install  →  cp .env.example .env  →  npm run dev
// ============================================================

require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Supabase clients ─────────────────────────────────────────
// Public client — respects RLS (for verifying user JWTs)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Admin client — bypasses RLS (for admin operations only)
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// ── Middleware ────────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
}));
app.use(express.json());

// Rate limiting — 100 requests per 15 minutes per IP
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use('/api', limiter);

// Tighter limit on auth endpoints
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: 'Too many requests. Try again later.' } });
app.use('/api/auth', authLimiter);

// ── Auth middleware ───────────────────────────────────────────
// Verifies the Supabase JWT from the Authorization header
// Attaches req.user and req.profile
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header.' });
  }
  const token = authHeader.split(' ')[1];
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid or expired session.' });

  // Attach profile
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  req.user    = user;
  req.profile = profile;
  next();
}

// Verifies user is an admin
async function requireAdmin(req, res, next) {
  await requireAuth(req, res, async () => {
    if (!req.profile || req.profile.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required.' });
    }
    next();
  });
}

// ══════════════════════════════════════════════════════════════
//  AUTH ROUTES
// ══════════════════════════════════════════════════════════════

// POST /api/auth/lookup
// Frontend sends {username}, backend returns {email} so frontend can sign in via Supabase JS
app.post('/api/auth/lookup', async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Username is required.' });

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('email, role')
    .eq('username', username.toLowerCase().trim())
    .single();

  if (error || !data) return res.status(404).json({ error: 'Username not found.' });
  res.json({ email: data.email, role: data.role });
});

// GET /api/auth/me
// Returns the current user's full profile
app.get('/api/auth/me', requireAuth, async (req, res) => {
  res.json({ user: req.user, profile: req.profile });
});

// POST /api/auth/logout-activity
// Logs a logout event
app.post('/api/auth/logout-activity', requireAuth, async (req, res) => {
  await supabaseAdmin.from('activity_log').insert({
    user_id: req.user.id,
    action: 'logout',
    details: 'User logged out',
  });
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════
//  ADMIN ROUTES — all require admin role
// ══════════════════════════════════════════════════════════════

// GET /api/admin/users
// List all students with progress summary
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('admin_student_overview')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ users: data });
});

// POST /api/admin/users
// Create a new student account
app.post('/api/admin/users', requireAdmin, async (req, res) => {
  const { full_name, username, email, password, grade, role = 'student' } = req.body;

  if (!full_name || !username || !email || !password) {
    return res.status(400).json({ error: 'full_name, username, email and password are required.' });
  }

  // Check username not already taken
  const { data: existing } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('username', username.toLowerCase())
    .single();

  if (existing) return res.status(409).json({ error: 'Username already taken.' });

  // Create auth user
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,  // skip email verification
    user_metadata: {
      username:  username.toLowerCase(),
      full_name,
      grade:     grade || 'Secondary 3',
      role,
    },
  });

  if (authError) return res.status(400).json({ error: authError.message });

  // Log the action
  await supabaseAdmin.from('activity_log').insert({
    user_id:  authData.user.id,
    actor_id: req.user.id,
    action:   'account_created',
    details:  `Account created for ${full_name} (@${username}) by admin`,
  });

  res.status(201).json({
    success: true,
    user: {
      id:       authData.user.id,
      username: username.toLowerCase(),
      full_name,
      email,
      grade,
      role,
    },
  });
});

// PATCH /api/admin/users/:id
// Update user details or status
app.patch('/api/admin/users/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { full_name, grade, role, username, email } = req.body;

  const updates = {};
  if (full_name) updates.full_name = full_name;
  if (grade)     updates.grade     = grade;
  if (role)      updates.role      = role;
  if (username)  updates.username  = username.toLowerCase();
  if (email)     updates.email     = email;

  const { error } = await supabaseAdmin
    .from('profiles')
    .update(updates)
    .eq('id', id);

  if (error) return res.status(400).json({ error: error.message });

  // If email changed, update auth.users too
  if (email) {
    await supabaseAdmin.auth.admin.updateUserById(id, { email });
  }

  await supabaseAdmin.from('activity_log').insert({
    user_id:  id,
    actor_id: req.user.id,
    action:   'account_updated',
    details:  `Profile updated by admin`,
    metadata: updates,
  });

  res.json({ success: true });
});

// DELETE /api/admin/users/:id
// Delete a student account
app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  if (id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account.' });

  const { data: profile } = await supabaseAdmin.from('profiles').select('full_name, username').eq('id', id).single();

  const { error } = await supabaseAdmin.auth.admin.deleteUser(id);
  if (error) return res.status(400).json({ error: error.message });

  await supabaseAdmin.from('activity_log').insert({
    actor_id: req.user.id,
    action:   'account_deleted',
    details:  `Account deleted: ${profile?.full_name} (@${profile?.username})`,
  });

  res.json({ success: true });
});

// POST /api/admin/users/:id/reset-password
// Admin resets a student's password to a new temp password
app.post('/api/admin/users/:id/reset-password', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { new_password } = req.body;
  if (!new_password || new_password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const { error } = await supabaseAdmin.auth.admin.updateUserById(id, { password: new_password });
  if (error) return res.status(400).json({ error: error.message });

  const { data: profile } = await supabaseAdmin.from('profiles').select('full_name, username').eq('id', id).single();

  await supabaseAdmin.from('activity_log').insert({
    user_id:  id,
    actor_id: req.user.id,
    action:   'password_reset',
    details:  `Password reset by admin for ${profile?.full_name} (@${profile?.username})`,
  });

  res.json({ success: true });
});

// POST /api/admin/users/:id/suspend
// Toggle suspend/reactivate
app.post('/api/admin/users/:id/suspend', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { suspend } = req.body; // true = suspend, false = reactivate

  // Supabase doesn't have a built-in suspend, so we use a banned field
  const { error } = await supabaseAdmin.auth.admin.updateUserById(id, {
    ban_duration: suspend ? '87600h' : 'none', // 10 years = effectively banned
  });
  if (error) return res.status(400).json({ error: error.message });

  const { data: profile } = await supabaseAdmin.from('profiles').select('full_name').eq('id', id).single();

  await supabaseAdmin.from('activity_log').insert({
    user_id:  id,
    actor_id: req.user.id,
    action:   suspend ? 'account_suspended' : 'account_reactivated',
    details:  `${profile?.full_name} ${suspend ? 'suspended' : 'reactivated'} by admin`,
  });

  res.json({ success: true });
});

// GET /api/admin/activity
// Full activity log (all users)
app.get('/api/admin/activity', requireAdmin, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('activity_log')
    .select(`
      *,
      profiles!activity_log_user_id_fkey (full_name, username),
      actor:profiles!activity_log_actor_id_fkey (full_name, username)
    `)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ activity: data });
});

// ══════════════════════════════════════════════════════════════
//  PROGRESS ROUTES
// ══════════════════════════════════════════════════════════════

// GET /api/progress
// Get current user's full progress
app.get('/api/progress', requireAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('lesson_progress')
    .select('*')
    .eq('user_id', req.user.id)
    .order('updated_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ progress: data });
});

// POST /api/progress
// Upsert lesson progress
app.post('/api/progress', requireAuth, async (req, res) => {
  const { lesson_id, lesson_name, progress_pct } = req.body;
  if (!lesson_id || !lesson_name || progress_pct === undefined) {
    return res.status(400).json({ error: 'lesson_id, lesson_name, and progress_pct required.' });
  }

  const isCompleted  = progress_pct >= 100;
  const progressData = {
    user_id:      req.user.id,
    lesson_id,
    lesson_name,
    progress_pct: Math.min(100, Math.max(0, progress_pct)),
    completed:    isCompleted,
    completed_at: isCompleted ? new Date().toISOString() : null,
    updated_at:   new Date().toISOString(),
  };

  const { error } = await supabaseAdmin
    .from('lesson_progress')
    .upsert(progressData, { onConflict: 'user_id,lesson_id' });

  if (error) return res.status(400).json({ error: error.message });

  // Log completion
  if (isCompleted) {
    await supabaseAdmin.from('activity_log').insert({
      user_id: req.user.id,
      action:  'lesson_completed',
      details: `Completed ${lesson_name}`,
      metadata: { lesson_id },
    });
  }

  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════
//  QUIZ ROUTES
// ══════════════════════════════════════════════════════════════

// GET /api/quiz/scores
// Get current user's quiz scores
app.get('/api/quiz/scores', requireAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('quiz_scores')
    .select('*')
    .eq('user_id', req.user.id)
    .order('taken_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ scores: data });
});

// POST /api/quiz/submit
// Submit a quiz result
app.post('/api/quiz/submit', requireAuth, async (req, res) => {
  const { quiz_id, quiz_name, score, max_score, answers } = req.body;
  if (!quiz_id || !quiz_name || score === undefined || !max_score) {
    return res.status(400).json({ error: 'quiz_id, quiz_name, score, max_score required.' });
  }

  const { data, error } = await supabaseAdmin
    .from('quiz_scores')
    .insert({
      user_id:   req.user.id,
      quiz_id,
      quiz_name,
      score,
      max_score,
      answers:   answers || {},
      taken_at:  new Date().toISOString(),
    })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  await supabaseAdmin.from('activity_log').insert({
    user_id: req.user.id,
    action:  'quiz_submitted',
    details: `Scored ${score}/${max_score} on ${quiz_name}`,
    metadata: { quiz_id, score, max_score },
  });

  res.status(201).json({ success: true, score: data });
});

// ══════════════════════════════════════════════════════════════
//  HEALTH CHECK
// ══════════════════════════════════════════════════════════════
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found.' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error.' });
});

app.listen(PORT, () => {
  console.log(`\n  Logo Arduino Backend`);
  console.log(`  ─────────────────────`);
  console.log(`  Server:   http://localhost:${PORT}`);
  console.log(`  Health:   http://localhost:${PORT}/api/health\n`);
});
