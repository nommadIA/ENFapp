-- ENFapp: esquema do banco (Supabase). Seguro para rodar em projeto novo ou existente no SQL Editor.
create table if not exists public.app_data (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  key text not null, value jsonb, updated_at timestamptz default now(),
  primary key (user_id, key));
alter table public.app_data enable row level security;
drop policy if exists "dono le" on public.app_data;
create policy "dono le" on public.app_data for select using (auth.uid() = user_id);
drop policy if exists "dono insere" on public.app_data;
create policy "dono insere" on public.app_data for insert with check (auth.uid() = user_id);
drop policy if exists "dono atualiza" on public.app_data;
create policy "dono atualiza" on public.app_data for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "dono apaga" on public.app_data;
create policy "dono apaga" on public.app_data for delete using (auth.uid() = user_id);
do $$ begin
  alter publication supabase_realtime add table public.app_data;
exception when duplicate_object then null; end $$;

-- Arquivos (pastas por usuario: <uid>/documentos, assinaturas, produtividade)
insert into storage.buckets (id, name, public, file_size_limit) values ('enfapp','enfapp',false,10485760) on conflict (id) do nothing;
drop policy if exists "enfapp le" on storage.objects;
create policy "enfapp le" on storage.objects for select to authenticated using (bucket_id='enfapp' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "enfapp envia" on storage.objects;
create policy "enfapp envia" on storage.objects for insert to authenticated with check (bucket_id='enfapp' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "enfapp atualiza" on storage.objects;
create policy "enfapp atualiza" on storage.objects for update to authenticated using (bucket_id='enfapp' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "enfapp apaga" on storage.objects;
create policy "enfapp apaga" on storage.objects for delete to authenticated using (bucket_id='enfapp' and (storage.foldername(name))[1]=auth.uid()::text);

-- Perfis, planos, controle de acesso e conta master (troque o e-mail master abaixo)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text, nome text, avatar text, whatsapp text,
  plan text not null default 'basico' check (plan in ('basico','profissional','premium')),
  status text not null default 'ativo' check (status in ('ativo','teste','vencido','bloqueado')),
  plan_expires_at date,
  admin_notes text,
  trial_started_at timestamptz,
  plan_source_order_id uuid,
  role text not null default 'user' check (role in ('user','master')),
  created_at timestamptz default now(),
  updated_at timestamptz default now());
alter table public.profiles add column if not exists whatsapp text;
alter table public.profiles add column if not exists status text not null default 'ativo';
alter table public.profiles add column if not exists plan_expires_at date;
alter table public.profiles add column if not exists admin_notes text;
alter table public.profiles add column if not exists trial_started_at timestamptz;
alter table public.profiles add column if not exists plan_source_order_id uuid;
alter table public.profiles add column if not exists updated_at timestamptz default now();
update public.profiles set trial_started_at = coalesce(plan_expires_at::timestamptz, created_at, now())
  where status = 'teste' and trial_started_at is null;
alter table public.profiles enable row level security;
create or replace function public.is_master() returns boolean language sql stable security definer set search_path=public as
$$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'master') $$;
revoke execute on function public.is_master() from public, anon;
grant execute on function public.is_master() to authenticated;
drop policy if exists "perfil le" on public.profiles;
create policy "perfil le" on public.profiles for select to authenticated using (id = auth.uid() or public.is_master());
drop policy if exists "perfil atualiza" on public.profiles;
create policy "perfil atualiza" on public.profiles for update to authenticated using (id = auth.uid() or public.is_master()) with check (id = auth.uid() or public.is_master());
revoke update on public.profiles from authenticated, anon;
grant update (nome, avatar, whatsapp) on public.profiles to authenticated;
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
declare m boolean := lower(new.email) = 'gmdesignferoz@gmail.com';
begin
  insert into public.profiles (id,email,nome,avatar,whatsapp,role,plan,status)
  values (new.id,new.email,
    coalesce(new.raw_user_meta_data->>'nome',new.raw_user_meta_data->>'full_name',new.raw_user_meta_data->>'name',split_part(new.email,'@',1)),
    coalesce(new.raw_user_meta_data->>'avatar_url',new.raw_user_meta_data->>'picture'),
    new.raw_user_meta_data->>'whatsapp',
    case when m then 'master' else 'user' end, case when m then 'premium' else 'basico' end, 'ativo')
  on conflict (id) do nothing;
  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
create or replace function public.set_plan(p_id uuid, p_plan text) returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_master() then raise exception 'sem permissao'; end if;
  if p_plan not in ('basico','profissional','premium') then raise exception 'plano invalido'; end if;
  update public.profiles set plan = p_plan, updated_at = now() where id = p_id and role <> 'master';
end $$;
revoke execute on function public.set_plan(uuid,text) from public, anon;
grant execute on function public.set_plan(uuid,text) to authenticated;

-- Limites e valores por plano (Relatorios, Produtividade e Precos configurados pelo Master)
create table if not exists public.plan_limits (
  plan text primary key check (plan in ('basico','profissional','premium')),
  rel int, fichas int,
  price_monthly numeric(10,2) not null default 0,
  price_annual numeric(10,2) not null default 0,
  trial_days int not null default 7,
  badge text,
  subtitle text,
  pix_key text,
  admin_whatsapp text,
  admin_name text,
  card_link_monthly text,
  card_link_annual text,
  card_installments text,
  card_link_default text);
alter table public.plan_limits add column if not exists price_monthly numeric(10,2) not null default 0;
alter table public.plan_limits add column if not exists price_annual numeric(10,2) not null default 0;
alter table public.plan_limits add column if not exists trial_days int not null default 7;
alter table public.plan_limits add column if not exists badge text;
alter table public.plan_limits add column if not exists subtitle text;
alter table public.plan_limits add column if not exists pix_key text;
alter table public.plan_limits add column if not exists admin_whatsapp text;
alter table public.plan_limits add column if not exists admin_name text;
alter table public.plan_limits add column if not exists card_link_monthly text;
alter table public.plan_limits add column if not exists card_link_annual text;
alter table public.plan_limits add column if not exists card_installments text;
alter table public.plan_limits add column if not exists card_link_default text;
insert into public.plan_limits (plan, rel, fichas, price_monthly, price_annual, trial_days, badge, subtitle) values
  ('basico',10,5,19.90,199.00,7,'Essencial','Ideal para organizar seus plantões e documentos'),
  ('profissional',50,20,34.90,349.00,7,'Mais escolhido','Mais relatórios e produtividade para quem faz vários plantões'),
  ('premium',null,null,49.90,499.00,7,'VIP · Tudo liberado','Acesso ilimitado, Mercado completo e backup na nuvem')
on conflict (plan) do nothing;

-- Compras avulsas (Checkout Pro): o plano só é liberado pelo webhook após aprovação.
create table if not exists public.payment_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan text not null check (plan in ('basico','profissional','premium')),
  cycle text not null check (cycle in ('mensal','anual')),
  amount numeric(10,2) not null check (amount > 0),
  currency text not null default 'BRL' check (currency = 'BRL'),
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled','refunded','charged_back','in_process')),
  preference_id text unique,
  payment_id text unique,
  payment_status text,
  status_detail text,
  paid_at timestamptz,
  expires_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.payment_orders enable row level security;
drop policy if exists "pedido le dono" on public.payment_orders;
create policy "pedido le dono" on public.payment_orders for select to authenticated using (user_id = auth.uid() or public.is_master());
revoke all on public.payment_orders from anon, authenticated;
grant select on public.payment_orders to authenticated;
grant all on public.payment_orders to service_role;
alter table public.plan_limits enable row level security;
drop policy if exists "limites le" on public.plan_limits;
create policy "limites le" on public.plan_limits for select to authenticated using (true);
drop policy if exists "limites master atualiza" on public.plan_limits;
create policy "limites master atualiza" on public.plan_limits for update to authenticated using (public.is_master()) with check (public.is_master());
revoke all on public.plan_limits from anon;
revoke insert, delete on public.plan_limits from authenticated;

-- Notificacoes do administrador para os usuarios (fatura, vencimento, mudanca de plano, bloqueio)
create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  user_email text,
  kind text not null default 'info' check (kind in ('info','plano','fatura','vencimento','sucesso','bloqueio')),
  title text not null,
  body text not null,
  amount numeric(10,2),
  due_date date,
  read_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz default now());
alter table public.user_notifications enable row level security;
drop policy if exists "notifs le" on public.user_notifications;
create policy "notifs le" on public.user_notifications for select to authenticated using (user_id = auth.uid() or public.is_master());
drop policy if exists "notifs dono marca lida" on public.user_notifications;
create policy "notifs dono marca lida" on public.user_notifications for update to authenticated using (user_id = auth.uid() or public.is_master()) with check (user_id = auth.uid() or public.is_master());
drop policy if exists "notifs master cria" on public.user_notifications;
create policy "notifs master cria" on public.user_notifications for insert to authenticated with check (public.is_master() or user_id = auth.uid());
drop policy if exists "notifs master apaga" on public.user_notifications;
create policy "notifs master apaga" on public.user_notifications for delete to authenticated using (public.is_master());
do $$ begin
  alter publication supabase_realtime add table public.user_notifications;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.profiles;
exception when duplicate_object then null; end $$;

-- RPC do Master: alterar plano, status (ativo/teste/vencido/bloqueado), validade, whatsapp e notificar
create or replace function public.admin_manage_user(
  p_id uuid, p_plan text, p_status text, p_expires date default null,
  p_whatsapp text default null, p_notes text default null,
  p_notif_title text default null, p_notif_body text default null, p_notif_kind text default 'plano',
  p_amount numeric default null
) returns void language plpgsql security definer set search_path=public as $$
declare u_email text;
begin
  if not public.is_master() then raise exception 'sem permissao'; end if;
  if p_plan not in ('basico','profissional','premium') then raise exception 'plano invalido'; end if;
  if p_status not in ('ativo','teste','vencido','bloqueado') then raise exception 'status invalido'; end if;
  update public.profiles
    set plan = p_plan, status = p_status, plan_expires_at = p_expires, plan_source_order_id = null,
        whatsapp = coalesce(p_whatsapp, whatsapp), admin_notes = p_notes, updated_at = now()
    where id = p_id and role <> 'master'
    returning email into u_email;
  if p_notif_title is not null and p_notif_body is not null then
    insert into public.user_notifications (user_id, user_email, kind, title, body, amount, due_date, created_by)
    values (p_id, u_email, coalesce(p_notif_kind,'plano'), p_notif_title, p_notif_body, p_amount, p_expires, auth.uid());
  end if;
end $$;
revoke execute on function public.admin_manage_user(uuid,text,text,date,text,text,text,text,text,numeric) from public, anon;
grant execute on function public.admin_manage_user(uuid,text,text,date,text,text,text,text,text,numeric) to authenticated;

-- RPC exclusivo do backend para sincronizar pagamentos verificados no Mercado Pago.
create or replace function public.apply_mercadopago_payment(
  p_order_id uuid, p_payment_id text, p_payment_status text,
  p_amount numeric, p_currency text, p_status_detail text default null
) returns void language plpgsql security definer set search_path=public as $$
declare o public.payment_orders%rowtype; exp date; pl_name text;
begin
  if p_payment_status not in ('approved','pending','in_process','rejected','cancelled','refunded','charged_back') then
    raise exception 'status de pagamento invalido';
  end if;
  if p_payment_id is null or length(p_payment_id) = 0 then raise exception 'id do pagamento ausente'; end if;
  select * into o from public.payment_orders where id = p_order_id for update;
  if not found then raise exception 'pedido nao encontrado'; end if;

  if p_payment_status = 'approved' then
    if p_amount is distinct from o.amount or p_currency is distinct from o.currency then
      raise exception 'valor ou moeda do pagamento nao confere';
    end if;
    if o.status = 'approved' and o.payment_id = p_payment_id then return; end if;
    if o.status = 'approved' then raise exception 'pedido ja aprovado com outro pagamento'; end if;
    exp := current_date + case when o.cycle = 'anual' then 365 else 30 end;
    pl_name := case o.plan when 'basico' then 'Básico' when 'profissional' then 'Profissional' else 'Premium' end;
    update public.profiles set plan = o.plan, status = 'ativo', plan_expires_at = exp,
      plan_source_order_id = o.id, updated_at = now() where id = o.user_id and role <> 'master';
    if not found then raise exception 'perfil do comprador nao encontrado'; end if;
    update public.payment_orders set status = 'approved', payment_id = p_payment_id,
      payment_status = p_payment_status, status_detail = p_status_detail,
      paid_at = coalesce(paid_at, now()), expires_at = exp, updated_at = now() where id = o.id;
    insert into public.user_notifications (user_id, kind, title, body, amount, due_date, created_by)
    values (o.user_id, 'sucesso', 'Pagamento aprovado',
      'Seu pagamento foi confirmado pelo Mercado Pago. O plano ' || pl_name ||
      ' está ativo até ' || to_char(exp,'DD/MM/YYYY') || '.', o.amount, exp, o.user_id);
  else
    update public.payment_orders set
      status = case when p_payment_status = 'in_process' then 'in_process' else p_payment_status end,
      payment_id = coalesce(payment_id, p_payment_id), payment_status = p_payment_status,
      status_detail = p_status_detail, updated_at = now()
      where id = o.id and status <> 'approved';
    if p_payment_status in ('refunded','charged_back') then
      update public.payment_orders set status = p_payment_status, payment_status = p_payment_status,
        status_detail = p_status_detail, updated_at = now() where id = o.id;
      update public.profiles set plan = 'basico', status = 'vencido',
        plan_expires_at = current_date - 1, plan_source_order_id = null, updated_at = now()
        where id = o.user_id and plan_source_order_id = o.id;
    end if;
  end if;
end $$;
revoke execute on function public.apply_mercadopago_payment(uuid,text,text,numeric,text,text) from public, anon, authenticated;
grant execute on function public.apply_mercadopago_payment(uuid,text,text,numeric,text,text) to service_role;

-- RPC do usuário: somente teste gratuito. Planos pagos são liberados pelo webhook.
create or replace function public.user_change_plan(p_plan text, p_cycle text default 'mensal', p_trial boolean default false) returns void language plpgsql security definer set search_path=public as $$
declare st text; days int; exp date; pl_name text; started timestamptz;
begin
  if p_plan not in ('basico','profissional','premium') then raise exception 'plano invalido'; end if;
  if p_cycle not in ('mensal','anual') then raise exception 'ciclo invalido'; end if;
  if not p_trial then raise exception 'pagamento precisa ser aprovado pelo Mercado Pago'; end if;
  select status, trial_started_at into st, started from public.profiles where id = auth.uid();
  if st = 'bloqueado' then raise exception 'conta bloqueada'; end if;
  if started is not null then raise exception 'teste gratuito ja utilizado'; end if;
  select coalesce(trial_days, 7) into days from public.plan_limits where plan = p_plan;
  exp := current_date + days;
  update public.profiles
    set plan = p_plan, status = 'teste', plan_expires_at = exp,
        trial_started_at = now(), plan_source_order_id = null, updated_at = now()
    where id = auth.uid() and role <> 'master';
  pl_name := case p_plan when 'basico' then 'Básico' when 'profissional' then 'Profissional' else 'Premium' end;
  insert into public.user_notifications (user_id, kind, title, body, due_date, created_by)
  values (auth.uid(), 'plano',
    'Período de teste ativado',
    'Seu plano agora é ' || pl_name || ' (teste gratuito) com validade até ' || to_char(exp,'DD/MM/YYYY') || '.',
    exp, auth.uid());
end $$;
revoke execute on function public.user_change_plan(text,text,boolean) from public, anon;
grant execute on function public.user_change_plan(text,text,boolean) to authenticated;

create or replace function public.check_limits() returns trigger language plpgsql security definer set search_path=public as $$
declare pl text; rl text; lim int; n int; o int;
begin
  if new.key not in ('enf_rel','enf_fichas') or jsonb_typeof(new.value) <> 'array' then return new; end if;
  select plan, role into pl, rl from public.profiles where id = new.user_id;
  if rl = 'master' or pl is null then return new; end if;
  select case when new.key='enf_rel' then rel else fichas end into lim from public.plan_limits where plan = pl;
  if lim is null then return new; end if;
  n := jsonb_array_length(new.value);
  o := case when tg_op='UPDATE' and jsonb_typeof(old.value)='array' then jsonb_array_length(old.value) else 0 end;
  if n > lim and n > o then raise exception 'limite do plano atingido'; end if;
  return new;
end $$;
revoke execute on function public.check_limits() from public, anon, authenticated;
drop trigger if exists app_data_limites on public.app_data;
create trigger app_data_limites before insert or update on public.app_data for each row execute function public.check_limits();

-- Notificacoes Push (Web Push / PWA)
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  tz text default 'America/Sao_Paulo',
  updated_at timestamptz default now());
alter table public.push_subscriptions enable row level security;
drop policy if exists "push dono" on public.push_subscriptions;
create policy "push dono" on public.push_subscriptions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create or replace function public.claim_push(p_endpoint text, p_p256dh text, p_auth text, p_tz text default 'America/Sao_Paulo') returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'nao autenticado'; end if;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth, tz, updated_at)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth, coalesce(p_tz, 'America/Sao_Paulo'), now())
  on conflict (endpoint) do update set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth, tz = excluded.tz, updated_at = now();
end $$;
revoke execute on function public.claim_push(text,text,text,text) from public, anon;
grant execute on function public.claim_push(text,text,text,text) to authenticated;
