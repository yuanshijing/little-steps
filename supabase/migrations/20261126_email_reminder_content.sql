begin;
create or replace function public.claim_reminder_email_content(token text, test_mode boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if test_mode then
  return public.claim_reminder_email(token,test_mode);
 end if;
 if not exists(select 1 from vault.decrypted_secrets where name='planet_reminder_cron' and decrypted_secret=token) then
  return null;
 end if;
 return (
  select coalesce(jsonb_agg(to_jsonb(job) || jsonb_build_object('reminder_title',
    case when job.reminder_id like 'custom-%' then left(settings.payload->'times'->job.reminder_id->>'title',60) end)), '[]'::jsonb)
  from public.claim_reminder_email() job
  left join public.planet_settings settings on settings.user_id=job.user_id
 );
end;
$$;
revoke all on function public.claim_reminder_email_content(text,boolean) from public,anon,authenticated;
grant execute on function public.claim_reminder_email_content(text,boolean) to service_role;
commit;
