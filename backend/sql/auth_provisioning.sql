-- 회원가입 provisioning: auth.users → app_user·profile·user_agreement + RLS
-- 멱등(재실행 안전). Supabase SQL editor 또는 APP_DB_URL 로 적용.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.app_user (id)
    values (new.id)
    on conflict (id) do nothing;

  insert into public.profile (user_id, nickname)
    values (new.id, coalesce(nullif(new.raw_user_meta_data->>'nickname', ''), split_part(new.email, '@', 1)))
    on conflict (user_id) do nothing;

  insert into public.user_agreement (user_id, agreement_type, version, is_agreed, agreed_at)
    values
      (new.id, 'terms',     'v1', true, now()),
      (new.id, 'privacy',   'v1', true, now()),
      (new.id, 'marketing', 'v1', coalesce((new.raw_user_meta_data->>'agree_marketing')::boolean, false), now())
    on conflict (user_id, agreement_type, version) do nothing;

  return new;
end;
$$;;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

alter table public.app_user enable row level security;

alter table public.profile enable row level security;

alter table public.user_agreement enable row level security;

drop policy if exists app_user_self on public.app_user;

create policy app_user_self on public.app_user for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists profile_self on public.profile;

create policy profile_self on public.profile for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists user_agreement_self on public.user_agreement;

create policy user_agreement_self on public.user_agreement for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
