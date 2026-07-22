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

-- 3. Create activity table
CREATE TABLE IF NOT EXISTS public.activity (
    id SERIAL PRIMARY KEY,
    day TEXT NOT NULL,
    completed INTEGER DEFAULT 0,
    added INTEGER DEFAULT 0
);

-- 4. Create team_members table
--    - role: job title (e.g., "Backend Engineer")
--    - position: access level ("admin" or "member")
--    - password: hashed password for login
--    - active: false means soft-deleted (preserves task history)
CREATE TABLE IF NOT EXISTS public.team_members (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    position TEXT DEFAULT 'member',
    avatar_bg TEXT DEFAULT '#6366f1',
    capacity INTEGER DEFAULT 0,
    tasks INTEGER DEFAULT 0,
    status TEXT DEFAULT 'healthy',
    active BOOLEAN DEFAULT true,
    email TEXT UNIQUE,
    password TEXT DEFAULT ''
);

-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATIONS: Safe to run on existing databases (idempotent)
-- ─────────────────────────────────────────────────────────────────────────────

-- Add missing columns to projects table
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS meeting_time TEXT DEFAULT '';
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP DEFAULT NULL;

-- Add missing columns to team_members table
ALTER TABLE public.team_members ADD COLUMN IF NOT EXISTS password TEXT DEFAULT '';
ALTER TABLE public.team_members ADD COLUMN IF NOT EXISTS position TEXT DEFAULT 'member';

-- Ensure all existing projects are active
UPDATE public.projects SET active = true WHERE active IS NULL;
