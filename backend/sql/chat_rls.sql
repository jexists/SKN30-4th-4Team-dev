-- 채팅 기록: chat_room·chat_message RLS + user_id 기본값 + authenticated 권한
-- 멱등(재실행 안전). 프론트가 Supabase 클라이언트로 자기 채팅만 read/write.

alter table public.chat_room alter column user_id set default auth.uid();

alter table public.chat_room enable row level security;

alter table public.chat_message enable row level security;

drop policy if exists chat_room_self on public.chat_room;

create policy chat_room_self on public.chat_room for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists chat_message_own on public.chat_message;

create policy chat_message_own on public.chat_message for all using (exists (select 1 from public.chat_room r where r.id = chat_message.chat_room_id and r.user_id = auth.uid())) with check (exists (select 1 from public.chat_room r where r.id = chat_message.chat_room_id and r.user_id = auth.uid()));

grant select, insert, update, delete on public.chat_room to authenticated;

grant select, insert, update, delete on public.chat_message to authenticated;
