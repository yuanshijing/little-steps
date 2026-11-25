begin;
create table if not exists public.trial_members (
 email text primary key check (email=lower(trim(email))),
 daily_limit integer not null default 30 check (daily_limit between 1 and 300),
 enabled boolean not null default true
);
create table if not exists public.trial_daily (
 user_id uuid references auth.users(id) on delete cascade,
 day date not null, requests integer not null default 0, tokens bigint not null default 0,
 primary key(user_id,day)
);
alter table public.trial_members enable row level security;
alter table public.trial_daily enable row level security;
revoke all on public.trial_members, public.trial_daily from public, anon, authenticated;
create or replace function public.trial_access(uid uuid, member_email text, reserve boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare lim integer; used integer; total bigint; d date := (now() at time zone 'Asia/Shanghai')::date;
begin
 select daily_limit into lim from public.trial_members where email=lower(member_email) and enabled for share;
 if lim is null then return jsonb_build_object('eligible',false); end if;
 if reserve then
   insert into public.trial_daily as t(user_id,day,requests) values(uid,d,1)
   on conflict(user_id,day) do update set requests=t.requests+1 where t.requests<lim
   returning requests,tokens into used,total;
   if not found then return jsonb_build_object('eligible',true,'limited',true); end if;
 else
   select requests,tokens into used,total from public.trial_daily where user_id=uid and day=d;
 end if;
 return jsonb_build_object('eligible',true,'limit',lim,'used',coalesce(used,0),'tokens',coalesce(total,0),'day',d);
end $$;
create or replace function public.trial_report(uid uuid, usage_day date, consumed integer)
returns void language sql security definer set search_path='' as $$
 update public.trial_daily set tokens=tokens+greatest(0,consumed) where user_id=uid and day=usage_day;
$$;
revoke all on function public.trial_access(uuid,text,boolean),public.trial_report(uuid,date,integer) from public,anon,authenticated;
grant execute on function public.trial_access(uuid,text,boolean),public.trial_report(uuid,date,integer) to service_role;
commit;