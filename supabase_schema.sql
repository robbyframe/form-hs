-- Jalankan script ini di Supabase: Project Anda > SQL Editor > New query > Run

create table if not exists kv_store (
  key text not null,
  shared boolean not null default true,
  value text,
  updated_at timestamptz default now(),
  primary key (key, shared)
);

alter table kv_store enable row level security;

-- Kebijakan akses terbuka (tanpa login) supaya audiens bisa isi form
-- dan admin bisa baca/hapus dari browser. Lihat catatan keamanan di README.
create policy "public read" on kv_store
  for select using (true);

create policy "public insert" on kv_store
  for insert with check (true);

create policy "public update" on kv_store
  for update using (true);

create policy "public delete" on kv_store
  for delete using (true);
