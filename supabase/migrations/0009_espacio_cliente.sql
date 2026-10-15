-- ============================================================================
-- KODA · 0009_espacio_cliente.sql
-- "Mi espacio": cada usuario le enseña a KODA de qué van SUS búsquedas, y KODA
-- recuerda para siempre lo que va aprendiendo de sus decisiones.
--
--   koda_perfil      el espacio del usuario: qué vende, rubros / ciudades / palabras
--                    que busca y que evita, y su propia escala de importancia por señal.
--   koda_veredictos  una fila por prospecto sobre el que el usuario tomó una decisión
--                    (cambio de estado o 👍/👎). Guarda una FOTO de las características
--                    del prospecto, así lo aprendido sobrevive aunque se borre el prospecto.
--   koda_memoria     lo aprendido, sumado por característica (rubro, ciudad, señal,
--                    palabra del nombre…): cuántas veces fue "sí" y cuántas "no".
--
-- El aprendizaje es DETERMINISTA y vive en la base (sin modelos externos ni costo):
-- el scorer lee esta memoria y suma o resta hasta ±25 puntos a los prospectos que se
-- parecen a lo que el usuario aceptó o descartó. Nada se pierde al reiniciar nada.
--
-- Además: el "Plan sugerido" (CONECTA / PRO / ULTRA) es de Connexo, así que solo se
-- calcula para la cuenta propietaria; el resto de usuarios ya no lo tiene.
--
-- Requiere 0008 (profiles.es_propietario). Idempotente. Aplicar con:
--   npx supabase db query --linked -f supabase/migrations/0009_espacio_cliente.sql
-- (NUNCA `supabase db push`: 0001-0005 no están registradas.)
-- Orden: migración → desplegar funciones (koda-scorer, koda-normalizer) → push del front.
-- ============================================================================

do $$ begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles' and column_name = 'es_propietario'
  ) then
    raise exception 'Aplica antes 0008_propietario.sql (falta profiles.es_propietario).';
  end if;
end $$;

-- ── 1) El espacio del usuario ───────────────────────────────────────────────
create table if not exists public.koda_perfil (
  owner_id           uuid primary key references public.profiles(id) on delete cascade,
  negocio            text,                                -- qué vende / a qué se dedica
  cliente_ideal      text,                                -- a quién le vende
  rubros             text[] not null default '{}',        -- claves de grupo (restaurantes, salud…)
  ciudades           text[] not null default '{}',
  palabras_clave     text[] not null default '{}',        -- suman puntos si aparecen
  palabras_excluidas text[] not null default '{}',        -- restan puntos si aparecen
  pesos              jsonb  not null default '{}'::jsonb, -- {clave_de_señal: puntos} sobre las reglas globales
  aprende            boolean not null default true,       -- ¿KODA aprende de sus decisiones?
  version            int    not null default 1,           -- sube con cada cambio → obliga a recalcular
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Recorta, quita vacíos y duplicados (sin distinguir mayúsculas) conservando el orden.
create or replace function public.koda_limpiar_lista(p_in text[], p_max int, p_len int)
returns text[] language sql immutable set search_path = public as $$
  select coalesce(array_agg(x order by ord), '{}'::text[])
  from (
    select min(left(btrim(t), p_len)) as x, min(o) as ord
    from unnest(coalesce(p_in, '{}'::text[])) with ordinality as u(t, o)
    where btrim(t) <> ''
    group by lower(left(btrim(t), p_len))
    order by min(o)
    limit p_max
  ) s;
$$;

-- Sanea lo que llega del navegador y sube la versión (no se puede fijar a mano).
create or replace function public.koda_perfil_sanear()
returns trigger language plpgsql set search_path = public as $$
declare
  k      text;
  v      jsonb;
  limpio jsonb := '{}'::jsonb;
begin
  new.negocio       := nullif(left(btrim(coalesce(new.negocio, '')), 600), '');
  new.cliente_ideal := nullif(left(btrim(coalesce(new.cliente_ideal, '')), 600), '');
  new.rubros             := public.koda_limpiar_lista(new.rubros, 30, 40);
  new.ciudades           := public.koda_limpiar_lista(new.ciudades, 30, 60);
  new.palabras_clave     := public.koda_limpiar_lista(new.palabras_clave, 40, 60);
  new.palabras_excluidas := public.koda_limpiar_lista(new.palabras_excluidas, 40, 60);

  -- Pesos: solo claves válidas, números y acotados. Las reglas de seguridad legal
  -- (opt_out, ya_es_cliente, cerrado_permanente) no se pueden reescribir.
  if jsonb_typeof(coalesce(new.pesos, '{}'::jsonb)) <> 'object' then
    new.pesos := '{}'::jsonb;
  end if;
  for k, v in select key, value from jsonb_each(new.pesos) loop
    if k ~ '^[a-z0-9_]{1,40}$'
       and jsonb_typeof(v) = 'number'
       and k not in ('opt_out', 'ya_es_cliente', 'cerrado_permanente') then
      limpio := limpio || jsonb_build_object(k, greatest(-60, least(60, round((v #>> '{}')::numeric))));
    end if;
  end loop;
  new.pesos := limpio;

  if tg_op = 'INSERT' then
    new.version := 2;                 -- 1 = "sin espacio"; cualquier espacio real obliga a recalcular
  else
    new.owner_id   := old.owner_id;
    new.created_at := old.created_at;
    new.version    := old.version + 1;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_koda_perfil_sanear on public.koda_perfil;
create trigger trg_koda_perfil_sanear
  before insert or update on public.koda_perfil
  for each row execute function public.koda_perfil_sanear();

alter table public.koda_perfil enable row level security;
drop policy if exists "perfil: lectura"        on public.koda_perfil;
drop policy if exists "perfil: alta propia"    on public.koda_perfil;
drop policy if exists "perfil: edicion propia" on public.koda_perfil;
create policy "perfil: lectura" on public.koda_perfil for select
  using (owner_id = auth.uid() or public.is_propietario());
create policy "perfil: alta propia" on public.koda_perfil for insert
  with check (owner_id = auth.uid() and public.is_active_member());
create policy "perfil: edicion propia" on public.koda_perfil for update
  using (owner_id = auth.uid() and public.is_active_member())
  with check (owner_id = auth.uid());

-- ── 2) Memoria permanente ───────────────────────────────────────────────────
create table if not exists public.koda_memoria (
  owner_id   uuid not null references public.profiles(id) on delete cascade,
  feature    text not null,                       -- 'cat:restaurant', 'ciudad:quito', 'sig:sin_web', 'tok:dental'…
  pos        numeric(10,2) not null default 0,    -- peso acumulado de "sí"
  neg        numeric(10,2) not null default 0,    -- peso acumulado de "no"
  updated_at timestamptz not null default now(),
  primary key (owner_id, feature)
);

create table if not exists public.koda_veredictos (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  prospect_id uuid references public.prospects(id) on delete set null,   -- se conserva al borrar el prospecto
  nombre      text,
  por_estado  smallint not null default 0,        -- valor derivado del estado (-2..3)
  explicito   smallint,                           -- 👍 = 3 / 👎 = -3 / null
  aplicado    smallint not null default 0,        -- valor efectivo ya sumado a koda_memoria
  features    text[] not null default '{}',       -- foto de las características al aplicar
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists koda_veredictos_prospecto_key
  on public.koda_veredictos (prospect_id) where prospect_id is not null;
create index if not exists idx_koda_veredictos_owner on public.koda_veredictos (owner_id);

-- El usuario solo LEE su memoria; escribe únicamente a través de las funciones de abajo.
alter table public.koda_memoria    enable row level security;
alter table public.koda_veredictos enable row level security;
drop policy if exists "memoria: lectura"    on public.koda_memoria;
drop policy if exists "veredictos: lectura" on public.koda_veredictos;
create policy "memoria: lectura" on public.koda_memoria for select
  using (owner_id = auth.uid() or public.is_propietario());
create policy "veredictos: lectura" on public.koda_veredictos for select
  using (owner_id = auth.uid() or public.is_propietario());

-- ── 3) Cómo aprende KODA ────────────────────────────────────────────────────
-- Valor de una decisión según el estado: positivo = "me sirve", negativo = "no".
-- 'no_contactar' NO enseña nada: es una petición de privacidad, no de afinidad.
create or replace function public.koda_valor_estado(p_status public.prospect_status)
returns smallint language sql immutable as $$
  select (case p_status
    when 'cliente'     then 3
    when 'negociacion' then 2
    when 'interesado'  then 2
    when 'en_contacto' then 1
    when 'calificado'  then 1
    when 'descartado'  then -2
    else 0
  end)::smallint;
$$;

-- Características de un prospecto (lo que KODA recuerda de él).
create or replace function public.koda_features(p_prospect uuid)
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct f), '{}'::text[]) from (
    select 'cat:' || lower(btrim(p.categoria)) as f
      from prospects p
     where p.id = p_prospect and nullif(btrim(coalesce(p.categoria, '')), '') is not null
    union all
    select 'ciudad:' || lower(public.immutable_unaccent(btrim(p.ciudad)))
      from prospects p
     where p.id = p_prospect and nullif(btrim(coalesce(p.ciudad, '')), '') is not null
    union all
    select 'tipo:' || p.tipo::text from prospects p where p.id = p_prospect
    union all
    select 'sig:' || s.clave
      from prospect_signals s
     where s.prospect_id = p_prospect
       and s.clave not in ('ciudad_objetivo', 'rubro_con_plantilla', 'palabra_clave',
                           'palabra_excluida', 'ya_es_cliente', 'opt_out')
    union all
    select 'tok:' || w.w from (
      select t as w
        from prospects p,
             regexp_split_to_table(lower(public.immutable_unaccent(p.nombre)), '[^a-z0-9]+') as t
       where p.id = p_prospect
         and length(t) >= 4
         and t <> all (array['para', 'sucursal', 'ecuador', 'sociedad', 'compania', 'ltda', 'express', 'plus', 'centro'])
       limit 8
    ) w
  ) x;
$$;

-- Lo mismo para un lote (lo usa el scorer). Solo service_role.
create or replace function public.koda_features_lote(p_ids uuid[])
returns table (prospect_id uuid, features text[])
language sql stable security definer set search_path = public as $$
  select i, public.koda_features(i) from unnest(p_ids) as i;
$$;

create or replace function public.koda_memoria_sumar(p_owner uuid, p_features text[], p_pos numeric, p_neg numeric)
returns void language sql security definer set search_path = public as $$
  insert into koda_memoria (owner_id, feature, pos, neg)
  select p_owner, f, greatest(p_pos, 0), greatest(p_neg, 0) from unnest(p_features) as f
  on conflict (owner_id, feature) do update
    set pos        = greatest(0, koda_memoria.pos + p_pos),
        neg        = greatest(0, koda_memoria.neg + p_neg),
        updated_at = now();
$$;

-- Registra o corrige la decisión del dueño sobre un prospecto y reajusta la memoria
-- con la DIFERENCIA (cambiar de opinión no cuenta doble). Sube la versión del espacio
-- para que el scorer vuelva a calificar sus prospectos con lo nuevo.
create or replace function public.koda_registrar(
  p_prospect        uuid,
  p_por_estado      smallint,
  p_explicito       smallint,
  p_tocar_explicito boolean
) returns void language plpgsql security definer set search_path = public as $$
declare
  pr     prospects%rowtype;
  v      koda_veredictos%rowtype;
  nuevo  smallint;
  feats  text[];
begin
  select * into pr from prospects where id = p_prospect;
  if not found then return; end if;

  if not coalesce((select aprende from koda_perfil where owner_id = pr.owner_id), true) then
    return;                                           -- el usuario pausó el aprendizaje
  end if;

  select * into v from koda_veredictos where prospect_id = p_prospect for update;
  if not found then
    if coalesce(p_por_estado, 0) = 0 and not (p_tocar_explicito and p_explicito is not null) then
      return;                                         -- nada que recordar todavía
    end if;
    insert into koda_veredictos (owner_id, prospect_id, nombre, por_estado, explicito)
    values (pr.owner_id, pr.id, pr.nombre, coalesce(p_por_estado, 0),
            case when p_tocar_explicito then p_explicito end)
    returning * into v;
  else
    update koda_veredictos
       set por_estado = coalesce(p_por_estado, por_estado),
           explicito  = case when p_tocar_explicito then p_explicito else explicito end,
           nombre     = pr.nombre,
           updated_at = now()
     where id = v.id
     returning * into v;
  end if;

  nuevo := coalesce(v.explicito, v.por_estado);
  if nuevo = v.aplicado and nuevo <> 0 then
    -- mismo veredicto: solo refresca la foto de características
    feats := public.koda_features(pr.id);
    perform public.koda_memoria_sumar(pr.owner_id, v.features, -greatest(v.aplicado, 0), -greatest(-v.aplicado, 0));
    perform public.koda_memoria_sumar(pr.owner_id, feats, greatest(nuevo, 0), greatest(-nuevo, 0));
    update koda_veredictos set features = feats where id = v.id;
    return;
  end if;

  -- 1) retira lo que este prospecto había aportado antes
  if v.aplicado <> 0 then
    perform public.koda_memoria_sumar(pr.owner_id, v.features, -greatest(v.aplicado, 0), -greatest(-v.aplicado, 0));
  end if;
  -- 2) suma el veredicto actual con las características de ahora
  feats := case when nuevo <> 0 then public.koda_features(pr.id) else '{}'::text[] end;
  if nuevo <> 0 then
    perform public.koda_memoria_sumar(pr.owner_id, feats, greatest(nuevo, 0), greatest(-nuevo, 0));
  end if;
  update koda_veredictos set aplicado = nuevo, features = feats where id = v.id;
  delete from koda_memoria where owner_id = pr.owner_id and pos = 0 and neg = 0;

  -- 3) el espacio cambió → a recalcular (crea el espacio si aún no existía)
  insert into koda_perfil (owner_id) values (pr.owner_id)
  on conflict (owner_id) do update set updated_at = now();
end $$;

-- Cambiar el estado de un prospecto ES una decisión: KODA aprende solo.
-- Solo cuenta si la hace SU dueño en persona (la cuenta propietaria operando sobre el
-- espacio de otro, o una Edge Function, no deben moldear la memoria de ese usuario).
-- Nunca bloquea la operación principal: si el aprendizaje falla, solo avisa.
create or replace function public.trg_prospects_aprender()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or auth.uid() is distinct from new.owner_id then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;
  begin
    perform public.koda_registrar(new.id, public.koda_valor_estado(new.status), null, false);
  exception when others then
    raise warning 'koda aprendizaje: %', sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists trg_prospects_aprender on public.prospects;
create trigger trg_prospects_aprender
  after insert or update of status on public.prospects
  for each row execute function public.trg_prospects_aprender();

-- 👍 (3) / 👎 (-3) / quitar (0) sobre un prospecto PROPIO.
create or replace function public.koda_marcar_prospecto(p_prospect uuid, p_valor smallint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_active_member() then
    raise exception 'Sesión no válida.';
  end if;
  if p_valor not in (-3, 0, 3) then
    raise exception 'Valor no válido.';
  end if;
  if not exists (select 1 from prospects where id = p_prospect and owner_id = auth.uid()) then
    raise exception 'Solo puedes enseñarle a KODA con tus propios prospectos.';
  end if;
  perform public.koda_registrar(p_prospect, null, case when p_valor = 0 then null else p_valor end, true);
end $$;

-- Borra TODO lo aprendido (el usuario manda sobre su memoria).
create or replace function public.koda_olvidar()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_active_member() then
    raise exception 'Sesión no válida.';
  end if;
  delete from koda_veredictos where owner_id = auth.uid();
  delete from koda_memoria    where owner_id = auth.uid();
  insert into koda_perfil (owner_id) values (auth.uid())
  on conflict (owner_id) do update set updated_at = now();
end $$;

-- Resumen de lo aprendido: decisiones guardadas y su balance. Lo ve el dueño
-- (pantalla Mi espacio), la cuenta propietaria y el scorer (service_role).
create or replace function public.koda_resumen(p_owner uuid)
returns table (decisiones bigint, positivas bigint, negativas bigint, peso_pos bigint, peso_neg bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is not null and p_owner is distinct from auth.uid() and not public.is_propietario() then
    raise exception 'No autorizado.';
  end if;
  return query
  select count(*) filter (where aplicado <> 0),
         count(*) filter (where aplicado > 0),
         count(*) filter (where aplicado < 0),
         coalesce(sum(greatest(aplicado, 0)), 0)::bigint,
         coalesce(sum(greatest(-aplicado, 0)), 0)::bigint
    from koda_veredictos where owner_id = p_owner;
end $$;

-- ── 4) Calificación pendiente ───────────────────────────────────────────────
-- Un prospecto se vuelve a calificar cuando cambió el espacio de su dueño (versión)
-- o cuando el normalizer lo dejó marcado (score_desglose = {}).
alter table public.prospects add column if not exists score_version int not null default 0;
create index if not exists idx_prospects_owner_score_version on public.prospects (owner_id, score_version);

create or replace function public.koda_pendientes(p_owner uuid default null, p_limite int default 200)
returns table (
  id uuid, owner_id uuid, score int, plan_sugerido text,
  nombre text, categoria text, descripcion text, ciudad text
)
language sql stable security definer set search_path = public as $$
  select p.id, p.owner_id, p.score, p.plan_sugerido, p.nombre, p.categoria, p.descripcion, p.ciudad
    from prospects p
    left join koda_perfil f on f.owner_id = p.owner_id
   where (p_owner is null or p.owner_id = p_owner)
     and (p.score_version < coalesce(f.version, 1)
          or p.score_desglose is null
          or p.score_desglose = '{}'::jsonb)
   order by p.created_at desc
   limit greatest(1, least(coalesce(p_limite, 200), 500));
$$;

-- ── 5) Permisos de las funciones ────────────────────────────────────────────
-- Internas (solo otras funciones y service_role).
revoke all on function public.koda_features(uuid)                              from public, anon, authenticated;
revoke all on function public.koda_features_lote(uuid[])                       from public, anon, authenticated;
revoke all on function public.koda_memoria_sumar(uuid, text[], numeric, numeric) from public, anon, authenticated;
revoke all on function public.koda_registrar(uuid, smallint, smallint, boolean) from public, anon, authenticated;
revoke all on function public.koda_pendientes(uuid, int)                       from public, anon, authenticated;
grant execute on function public.koda_features_lote(uuid[]) to service_role;
grant execute on function public.koda_pendientes(uuid, int) to service_role;
-- Públicas (validan sesión adentro).
revoke all on function public.koda_marcar_prospecto(uuid, smallint) from public, anon;
revoke all on function public.koda_olvidar()                        from public, anon;
revoke all on function public.koda_resumen(uuid)                    from public, anon;
grant execute on function public.koda_marcar_prospecto(uuid, smallint) to authenticated;
grant execute on function public.koda_olvidar()                        to authenticated;
grant execute on function public.koda_resumen(uuid)                    to authenticated, service_role;

-- ── 6) Reglas de scoring: ahora relativas al nicho de cada usuario ──────────
-- Las claves no cambian (hay datos con ellas); cambia lo que significan: se miden
-- contra el espacio de cada usuario, no contra las ciudades/rubros de Connexo.
insert into scoring_rules (clave, descripcion, puntos, orden) values
  ('ciudad_objetivo',     'Está en una de tus ciudades objetivo',      10,  7),
  ('rubro_con_plantilla', 'Es de uno de tus rubros objetivo',            8,  8),
  ('palabra_clave',       'Menciona una de tus palabras clave',         12, 16),
  ('palabra_excluida',    'Menciona algo que quieres evitar',          -30, 17)
on conflict (clave) do update set descripcion = excluded.descripcion;   -- no pisa los puntos ya ajustados

-- ── 7) Plan sugerido: solo la cuenta propietaria ────────────────────────────
update public.prospects
   set plan_sugerido = null
 where plan_sugerido is not null
   and owner_id not in (select id from public.profiles where es_propietario);

-- ── 8) La cuenta propietaria conserva su nicho de siempre ───────────────────
-- Antes salía de constantes en el código (4 ciudades y los rubros "con plantilla").
-- Pasa a su espacio para que su puntaje no cambie; ella lo puede editar como cualquiera.
insert into public.koda_perfil (owner_id, rubros, ciudades)
select p.id,
       array['restaurantes', 'cafe_bar', 'belleza', 'salud', 'gimnasios'],
       array['Ibarra', 'Otavalo', 'Quito', 'Guayaquil']
  from public.profiles p
 where p.es_propietario
on conflict (owner_id) do nothing;
