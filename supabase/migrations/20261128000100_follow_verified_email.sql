begin;

create or replace function public.follow_verified_trial_email()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.email is null or new.email_confirmed_at is null
    or lower(new.email) is not distinct from lower(old.email) then
    return new;
  end if;

  insert into public.trial_members(email,daily_limit,enabled)
  select lower(new.email),member.daily_limit,true
  from public.trial_members member
  where member.email=lower(old.email) and member.enabled
  on conflict(email) do update
    set daily_limit=excluded.daily_limit, enabled=true;

  if found then
    update public.trial_members set enabled=false where email=lower(old.email);
  end if;
  return new;
end;
$$;

revoke all on function public.follow_verified_trial_email() from public,anon,authenticated;
drop trigger if exists follow_verified_trial_email on auth.users;
create trigger follow_verified_trial_email
after update of email on auth.users
for each row execute function public.follow_verified_trial_email();

commit;
