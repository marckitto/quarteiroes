-- Estrutura criada no projeto quarteiroes-paulinia (referência / recriação)
create sequence if not exists public.versao_seq;
create table public.autorizados (email text primary key, nome text, divisao text, admin boolean not null default false, criado_em date not null default current_date);
create table public.correcoes (chave text not null, numero integer not null check (numero > 0), rua text not null, quarteirao text, usuario text, mes text, versao bigint not null default 0, primary key (chave, numero));
create table public.aliases (de text primary key, para text not null, nome text, usuario text, mes text, versao bigint not null default 0);
create table public.condominios (id text primary key, dados jsonb not null, removido boolean not null default false, usuario text, mes text, versao bigint not null default 0);
create index on public.correcoes (versao); create index on public.aliases (versao); create index on public.condominios (versao);
create or replace function public.autorizado() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.autorizados a where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))); $$;
create or replace function public.eh_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.autorizados a where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', '')) and a.admin); $$;
create or replace function public.carimbar() returns trigger language plpgsql security invoker set search_path = public as $$
begin new.versao := nextval('public.versao_seq'); new.usuario := coalesce(auth.jwt() ->> 'email', new.usuario);
  new.mes := to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM'); return new; end $$;
create trigger carimbo_correcoes before insert or update on public.correcoes for each row execute function public.carimbar();
create trigger carimbo_aliases before insert or update on public.aliases for each row execute function public.carimbar();
create trigger carimbo_condominios before insert or update on public.condominios for each row execute function public.carimbar();
alter table public.autorizados enable row level security; alter table public.correcoes enable row level security;
alter table public.aliases enable row level security; alter table public.condominios enable row level security;
create policy autorizados_ver_proprio on public.autorizados for select to authenticated using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
create policy autorizados_admin_ver on public.autorizados for select to authenticated using (public.eh_admin());
create policy autorizados_admin_inserir on public.autorizados for insert to authenticated with check (public.eh_admin());
create policy autorizados_admin_alterar on public.autorizados for update to authenticated using (public.eh_admin()) with check (public.eh_admin());
create policy autorizados_admin_apagar on public.autorizados for delete to authenticated using (public.eh_admin() and lower(email) <> lower(coalesce(auth.jwt() ->> 'email', '')));
create policy correcoes_ler on public.correcoes for select to authenticated using (public.autorizado());
create policy correcoes_inserir on public.correcoes for insert to authenticated with check (public.autorizado());
create policy correcoes_alterar on public.correcoes for update to authenticated using (public.autorizado()) with check (public.autorizado());
create policy aliases_ler on public.aliases for select to authenticated using (public.autorizado());
create policy aliases_inserir on public.aliases for insert to authenticated with check (public.autorizado());
create policy aliases_alterar on public.aliases for update to authenticated using (public.autorizado()) with check (public.autorizado());
create policy condominios_ler on public.condominios for select to authenticated using (public.autorizado());
create policy condominios_inserir on public.condominios for insert to authenticated with check (public.autorizado());
create policy condominios_alterar on public.condominios for update to authenticated using (public.autorizado()) with check (public.autorizado());

-- origem da correção + proteção: importação em lote nunca sobrescreve correção manual
alter table public.correcoes add column if not exists fonte text not null default 'manual';
create or replace function public.proteger_manual() returns trigger language plpgsql security invoker set search_path = public as $$
begin if old.fonte = 'manual' and coalesce(new.fonte, 'manual') <> 'manual' then return null; end if; return new; end $$;
create trigger proteger_manual_correcoes before update on public.correcoes for each row execute function public.proteger_manual();
