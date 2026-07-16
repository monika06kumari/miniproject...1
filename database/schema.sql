-- Supabase SQL Setup Script
-- Paste this into your Supabase SQL Editor and click "Run"

-- 1. Create tasks table
CREATE TABLE IF NOT EXISTS public.tasks (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    project TEXT NOT NULL,
    assignee TEXT NOT NULL,
    status TEXT DEFAULT 'todo',
    priority TEXT DEFAULT 'medium',
    deadline TEXT DEFAULT 'TBD'
);

-- 2. Create projects table
CREATE TABLE IF NOT EXISTS public.projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    progress INTEGER DEFAULT 0,
    status TEXT DEFAULT 'on_track',
    deadline TEXT DEFAULT 'TBD',
    color TEXT DEFAULT '#6366f1',
    meeting_details TEXT DEFAULT '',
    meeting_time TEXT DEFAULT '',
    active BOOLEAN DEFAULT true,
    deleted_at TIMESTAMP DEFAULT NULL
);
-- 3. Insert initial projects
INSERT INTO public.projects (id, name, description, progress, status, deadline, color) VALUES 
('omega', 'Omega Platform', 'Core B2B SaaS platform rebuild', 62, 'at_risk', 'Aug 15, 2026', '#6366f1'),
('atlas', 'Atlas Mobile App', 'Cross-platform customer mobile experience', 81, 'on_track', 'Jul 30, 2026', '#10b981'),
('mercury', 'Mercury Dashboard', 'Real-time analytics & reporting UI', 40, 'at_risk', 'Sep 1, 2026', '#f59e0b'),
('nova', 'Nova API Gateway', 'Microservices API unification layer', 95, 'on_track', 'Jun 28, 2026', '#0ea5e9')
ON CONFLICT (id) DO NOTHING;

-- 4. Create activity table
CREATE TABLE IF NOT EXISTS public.activity (
    id SERIAL PRIMARY KEY,
    day TEXT NOT NULL,
    completed INTEGER DEFAULT 0,
    added INTEGER DEFAULT 0
);

-- 5. Create team_members table
--    active = false means "removed" (soft-delete preserves task history)
CREATE TABLE IF NOT EXISTS public.team_members (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    avatar_bg TEXT DEFAULT '#6366f1',
    capacity INTEGER DEFAULT 0,
    tasks INTEGER DEFAULT 0,
    status TEXT DEFAULT 'healthy',
    active BOOLEAN DEFAULT true
);

-- 6. Seed default team members
INSERT INTO public.team_members (name, role, avatar_bg, capacity, tasks, status, active) VALUES
('Alice', 'Frontend Engineer',  '#6366f1', 90, 8, 'overloaded', true),
('Bob',   'Backend Engineer',   '#0ea5e9', 75, 6, 'healthy',    true),
('Sarah', 'UI/UX Designer',     '#f43f5e', 60, 4, 'pto_friday', true),
('Alex',  'Full-Stack Engineer','#10b981', 85, 7, 'healthy',    true)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION: Run these if you already have an existing 'projects' table
-- and need to add the new columns (safe to run multiple times via ALTER)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS meeting_time TEXT DEFAULT '';
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP DEFAULT NULL;

-- Update all existing projects to be active (in case the column was just added)
UPDATE public.projects SET active = true WHERE active IS NULL;
