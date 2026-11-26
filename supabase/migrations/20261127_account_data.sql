begin;

create table public.planet_account_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  revision bigint not null default 1 check (revision > 0)
);

alter table public.planet_account_data enable row level security;
revoke all on public.planet_account_data from public, anon, authenticated;
grant select, insert, update on public.planet_account_data to authenticated;

create policy "Read own app data" on public.planet_account_data
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Create own app data" on public.planet_account_data
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Update own app data" on public.planet_account_data
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

commit;
