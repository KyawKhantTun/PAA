-- ============================================================
--  Logo Arduino Platform — Supabase Schema
--  Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- ── 1. PROFILES ─────────────────────────────────────────────
-- Extends auth.users with app-specific fields
CREATE TABLE IF NOT EXISTS public.profiles (
  id            uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username      text        UNIQUE NOT NULL,
  full_name     text        NOT NULL,
  email         text        NOT NULL,
  grade         text        DEFAULT 'Secondary 3',
  role          text        DEFAULT 'student' CHECK (role IN ('student', 'admin')),
  avatar_url    text,
  streak_days   int         DEFAULT 0,
  last_active   timestamptz DEFAULT now(),
  created_at    timestamptz DEFAULT now()
);

-- ── 2. LESSON PROGRESS ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lesson_progress (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  lesson_id     text        NOT NULL,   -- e.g. 'proj1', 'proj2', 'cpp_variables'
  lesson_name   text        NOT NULL,
  progress_pct  int         DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  completed     boolean     DEFAULT false,
  completed_at  timestamptz,
  updated_at    timestamptz DEFAULT now(),
  UNIQUE (user_id, lesson_id)
);

-- ── 3. QUIZ SCORES ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.quiz_scores (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  quiz_id       text        NOT NULL,   -- e.g. 'proj1_q1', 'led_quiz'
  quiz_name     text        NOT NULL,
  score         int         NOT NULL,
  max_score     int         NOT NULL,
  answers       jsonb,                  -- {q1: 'B', q2: 'A'}
  taken_at      timestamptz DEFAULT now()
);

-- ── 4. ACTIVITY LOG ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.activity_log (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_id      uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  action        text        NOT NULL,   -- 'login', 'complete_lesson', 'quiz_submit', etc.
  details       text,
  metadata      jsonb,
  created_at    timestamptz DEFAULT now()
);

-- ── 5. AUTO-CREATE PROFILE ON SIGNUP ────────────────────────
-- Trigger: when auth.users row is created, create matching profile
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, username, full_name, email, grade, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email,'@',1)),
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'grade', 'Secondary 3'),
    COALESCE(NEW.raw_user_meta_data->>'role', 'student')
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── 6. UPDATE last_active ON LOGIN ──────────────────────────
CREATE OR REPLACE FUNCTION public.update_last_active()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.profiles SET last_active = now() WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

-- ── 7. ROW LEVEL SECURITY (RLS) ─────────────────────────────
ALTER TABLE public.profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_scores     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_log    ENABLE ROW LEVEL SECURITY;

-- PROFILES policies
-- Students can read their own profile
CREATE POLICY "students_read_own_profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

-- Admins can read all profiles
CREATE POLICY "admins_read_all_profiles"
  ON public.profiles FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Admins can update all profiles
CREATE POLICY "admins_update_profiles"
  ON public.profiles FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Students can update their own profile (limited fields)
CREATE POLICY "students_update_own_profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- LESSON PROGRESS policies
CREATE POLICY "students_read_own_progress"
  ON public.lesson_progress FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "students_write_own_progress"
  ON public.lesson_progress FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "students_update_own_progress"
  ON public.lesson_progress FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "admins_read_all_progress"
  ON public.lesson_progress FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- QUIZ SCORES policies
CREATE POLICY "students_read_own_scores"
  ON public.quiz_scores FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "students_submit_scores"
  ON public.quiz_scores FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "admins_read_all_scores"
  ON public.quiz_scores FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ACTIVITY LOG policies
CREATE POLICY "students_read_own_activity"
  ON public.activity_log FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "students_write_activity"
  ON public.activity_log FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "admins_read_all_activity"
  ON public.activity_log FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ── 8. INDEXES ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_profiles_username      ON public.profiles(username);
CREATE INDEX IF NOT EXISTS idx_profiles_role          ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_lesson_user            ON public.lesson_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_quiz_user              ON public.quiz_scores(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_user          ON public.activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_created       ON public.activity_log(created_at DESC);

-- ── 9. HELPER VIEWS ─────────────────────────────────────────
-- Admin view: student overview with progress summary
CREATE OR REPLACE VIEW public.admin_student_overview AS
SELECT
  p.id,
  p.username,
  p.full_name,
  p.email,
  p.grade,
  p.role,
  p.last_active,
  p.created_at,
  p.streak_days,
  COUNT(DISTINCT lp.lesson_id) FILTER (WHERE lp.completed = true) AS lessons_completed,
  COALESCE(ROUND(AVG(lp.progress_pct)), 0)                         AS avg_progress,
  COUNT(DISTINCT qs.id)                                             AS quizzes_taken
FROM public.profiles p
LEFT JOIN public.lesson_progress lp ON lp.user_id = p.id
LEFT JOIN public.quiz_scores     qs ON qs.user_id = p.id
GROUP BY p.id;

-- ── 10. SEED: ADMIN ACCOUNT ─────────────────────────────────
-- Run AFTER creating your first user via the dashboard or API.
-- Replace 'YOUR_ADMIN_USER_ID' with the UUID from auth.users.
-- UPDATE public.profiles SET role = 'admin' WHERE username = 'admin';
