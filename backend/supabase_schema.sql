-- Run this in Supabase SQL editor before starting the backend.
-- If you already ran an earlier version of this schema, these ADD COLUMN
-- lines bring existing tables up to date without dropping data:
alter table if exists learning_paths add column if not exists skill_gaps text[] default '{}';
alter table if exists path_items add column if not exists item_type text default 'course';
alter table if exists path_items add column if not exists feedback text;

create table if not exists learner_profiles (
  user_id text primary key,
  goal text,
  interests text[] default '{}',
  skill_level text,
  known_topics text[] default '{}',
  updated_at timestamptz default now()
);

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz default now()
);

create table if not exists learning_paths (
  path_id uuid primary key,
  user_id text not null,
  skill_gaps text[] default '{}',
  created_at timestamptz default now()
);

create table if not exists path_items (
  id uuid primary key default gen_random_uuid(),
  path_id uuid references learning_paths(path_id),
  user_id text not null,
  "order" int not null,
  course_id text not null,
  title text not null,
  item_type text default 'course' check (item_type in ('course', 'project', 'resource')),
  reason text,
  milestone text,
  status text default 'not_started' check (status in ('not_started', 'in_progress', 'completed')),
  feedback text,
  created_at timestamptz default now()
);

-- Enable RLS and allow the service role (used only by the backend) full access.
alter table learner_profiles enable row level security;
alter table chat_messages enable row level security;
alter table learning_paths enable row level security;
alter table path_items enable row level security;

create policy "service role full access" on learner_profiles for all using (true) with check (true);
create policy "service role full access" on chat_messages for all using (true) with check (true);
create policy "service role full access" on learning_paths for all using (true) with check (true);
create policy "service role full access" on path_items for all using (true) with check (true);
-- NOTE: these permissive policies rely on the backend using the SERVICE ROLE
-- key (which bypasses RLS anyway) and the anon key never being used to write
-- directly. If you later let the frontend write to these tables directly
-- with the anon key, replace these with policies scoped to auth.uid().
