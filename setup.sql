-- ============================================================
-- Zentaryx — Supabase setup
-- Run this entire file in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- ── Tables ────────────────────────────────────

create table if not exists chats (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade not null,
  title      text not null default 'New Chat',
  agent      text not null default 'assistant',
  created_at timestamptz default now()
);

create table if not exists messages (
  id         uuid primary key default gen_random_uuid(),
  chat_id    uuid references chats(id) on delete cascade not null,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null,
  agent      text not null default 'assistant',
  created_at timestamptz default now()
);

-- ── Indexes (for performance) ─────────────────

create index if not exists chats_user_id_idx    on chats(user_id);
create index if not exists messages_chat_id_idx on messages(chat_id);

-- ── Row Level Security ────────────────────────

alter table chats    enable row level security;
alter table messages enable row level security;

-- Chats: users can only touch their own rows
create policy "chats_select" on chats for select using (auth.uid() = user_id);
create policy "chats_insert" on chats for insert with check (auth.uid() = user_id);
create policy "chats_update" on chats for update using (auth.uid() = user_id);
create policy "chats_delete" on chats for delete using (auth.uid() = user_id);

-- Messages: users can only touch messages in chats they own
create policy "messages_select" on messages for select using (
  exists (select 1 from chats where chats.id = messages.chat_id and chats.user_id = auth.uid())
);
create policy "messages_insert" on messages for insert with check (
  exists (select 1 from chats where chats.id = messages.chat_id and chats.user_id = auth.uid())
);
create policy "messages_delete" on messages for delete using (
  exists (select 1 from chats where chats.id = messages.chat_id and chats.user_id = auth.uid())
);
