begin;
alter table public.reminder_email_subscriptions alter column enabled set default true;
create or replace function public.claim_reminder_email()
returns table (user_id uuid, recipient text, reminder_id text, delivery_day date)
language sql security definer set search_path='' as $$
 with due as (
  select p.user_id,u.email::text as recipient,r.key as reminder_id,
         (now() at time zone 'Asia/Shanghai')::date as day
  from public.planet_settings p
  join auth.users u on u.id=p.user_id and u.email_confirmed_at is not null
  join public.trial_members m on m.email=lower(u.email) and m.enabled
  left join public.reminder_email_subscriptions s on s.user_id=p.user_id
  cross join lateral jsonb_each(case when jsonb_typeof(p.payload->'times')='object' then p.payload->'times' else '{}'::jsonb end) r
  where coalesce(s.enabled,true) and p.payload->'remind' is distinct from 'false'::jsonb
   and r.value->'enabled' is distinct from 'false'::jsonb
   and r.value->'removed' is distinct from 'true'::jsonb
   and r.value->>'time'=to_char(now() at time zone 'Asia/Shanghai','HH24:MI')
   and not exists (select 1 from public.reminder_email_deliveries d where d.user_id=p.user_id
    and d.reminder_id=r.key and d.day=(now() at time zone 'Asia/Shanghai')::date)
  order by p.user_id,r.key limit 20
 ), claimed as (
  insert into public.reminder_email_deliveries(user_id,reminder_id,day)
  select due.user_id,due.reminder_id,due.day from due on conflict do nothing
  returning reminder_email_deliveries.user_id,reminder_email_deliveries.reminder_id,reminder_email_deliveries.day
 )
 select due.user_id,due.recipient,due.reminder_id,due.day from due join claimed using(user_id,reminder_id,day);
$$;
revoke all on function public.claim_reminder_email() from public,anon,authenticated;
grant execute on function public.claim_reminder_email() to service_role;
commit;
