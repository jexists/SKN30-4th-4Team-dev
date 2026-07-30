-- 회원가입 provisioning: auth.users → app_user·profile·user_agreement + RLS
-- 멱등(재실행 안전). Supabase SQL editor 또는 APP_DB_URL 로 적용.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 카카오 OAuth 성공은 인증 식별자 생성일 뿐, 서비스 약관 동의 전이다.
  -- app_user가 서비스 회원의 기준이므로 가입 완료 API가 원자적으로 생성한다.
  if new.raw_app_meta_data->>'provider' = 'kakao' then
    return new;
  end if;

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

  -- 가입 축하 알림. 이메일 가입은 프론트가 Supabase Auth 를 직접 부르고 백엔드를 거치지
  -- 않으므로(이메일 인증이 켜져 있으면 세션조차 없다) 알림을 만들 수 있는 지점이 여기뿐이다.
  -- 카카오 가입은 위에서 return 했고, 가입 완료 API 가 같은 문구로 만든다.
  -- 중복은 uq_notification_dedupe (user_id, dedupe_key) 가 막는다 (sql/schema.sql).
  -- dedupe_key 를 빠뜨리면 그 방어가 통째로 풀리므로 반드시 'welcome' 을 함께 넣는다.
  insert into public.notification (user_id, type, dedupe_key, title, content)
    values (new.id, 'WELCOME', 'welcome',
            '회원가입을 축하합니다.', 'AI 분석으로 안전한 계약을 시작해보세요.')
    on conflict do nothing;

  return new;
end;
$$;

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
