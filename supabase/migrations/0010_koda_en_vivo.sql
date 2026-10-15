-- ============================================================================
-- KODA · 0010_koda_en_vivo.sql
-- KODA aprende en vivo y de más cosas, y le devuelve al usuario lo que aprendió.
--
--   · Más señales: además del estado y el 👍/👎, KODA aprende cuando el usuario
--     ASIGNA un prospecto, lo VERIFICA o abre sus enlaces (web, WhatsApp, Instagram,
--     Maps). Es "interés por actividad" (nivel 1): nunca pisa un estado ni un 👍/👎.
--   · Pulso en vivo: `koda_pendientes_mios()` dice cuántos prospectos del usuario
--     esperan recalificarse; el front lo consulta y dispara el scorer al instante.
--   · `koda_ultimo_aprendizaje()` devuelve lo último que KODA aprendió, para
--     avisarle al usuario ("KODA aprendió: te interesan dentist · Quito").
--   · `koda_pendientes()` ahora trae el desglose actual para que el scorer no
--     reescriba prospectos cuyo puntaje no cambió.
--
-- Requiere 0009. Idempotente. Aplicar con:
--   npx supabase db query --linked -f supabase/migrations/0010_koda_en_vivo.sql
-- (NUNCA `supabase db push`.)  Orden: migración → desplegar koda-scorer → push del front.
-- ============================================================================

do $$ begin
  if not exists (
    select 1 from information_schema.tables where table_schema = 'public' and table_name = 'koda_veredictos'
  ) then
    raise exception 'Aplica antes 0009_espacio_cliente.sql.';
  end if;
end $$;

-- ── 1) Interés por actividad ────────────────────────────────────────────────
alter table public.koda_veredictos add column if not exists por_actividad smallint not null default 0;

-- Nueva firma (con p_actividad): se elimina la anterior para no dejar dos versiones.
drop function if exists public.koda_registrar(uuid, smallint, smallint, boolean);

-- Registra o corrige la decisión del dueño sobre un prospecto y reajusta la memoria con
-- la DIFERENCIA. Valor efectivo: 👍/👎 explícito > estado > actividad.
create or replace function public.koda_registrar(
  p_prospect        uuid,
  p_por_estado      smallint,
  p_explicito       smallint,
  p_tocar_explicito boolean,
  p_actividad       smallint default 0
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
    if coalesce(p_por_estado, 0) = 0
       and not (p_tocar_explicito and p_explicito is not null)
       and coalesce(p_actividad, 0) = 0 then
      return;                                         -- nada que recordar todavía
    end if;
    insert into koda_veredictos (owner_id, prospect_id, nombre, por_estado, explicito, por_actividad, updated_at)
    values (pr.owner_id, pr.id, pr.nombre, coalesce(p_por_estado, 0),
            case when p_tocar_explicito then p_explicito end,
            greatest(0, coalesce(p_actividad, 0)), clock_timestamp())
    returning * into v;
  else
    update koda_veredictos
       set por_estado    = coalesce(p_por_estado, por_estado),
           explicito     = case when p_tocar_explicito then p_explicito else explicito end,
           por_actividad = greatest(por_actividad, coalesce(p_actividad, 0)),
           nombre        = pr.nombre,
           updated_at    = clock_timestamp()      -- exacto aun dentro de una misma transacción
     where id = v.id
     returning * into v;
  end if;

  nuevo := coalesce(v.explicito, nullif(v.por_estado, 0), v.por_actividad);
  if nuevo = v.aplicado and nuevo <> 0 then
    -- mismo veredicto: solo refresca la foto de características (no sube la versión)
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

revoke all on function public.koda_registrar(uuid, smallint, smallint, boolean, smallint) from public, anon, authenticated;

-- El 👍/👎 llama a la nueva firma (el resto de parámetros no cambia).
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
  perform public.koda_registrar(p_prospect, null, case when p_valor = 0 then null else p_valor end, true, 0::smallint);
end $$;

-- Aprende del estado (como antes) y ahora también de asignar / verificar.
-- Solo cuenta si lo hace SU dueño en persona; nunca bloquea la operación principal.
create or replace function public.trg_prospects_aprender()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_estado smallint := null;
  v_act    smallint := 0;
  v_cambio boolean  := false;
begin
  if auth.uid() is null or auth.uid() is distinct from new.owner_id then
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_estado := public.koda_valor_estado(new.status);
    v_cambio := v_estado <> 0;
  else
    if new.status is distinct from old.status then
      v_estado := public.koda_valor_estado(new.status);
      v_cambio := true;
    end if;
    if (new.assigned_to is distinct from old.assigned_to and nullif(btrim(coalesce(new.assigned_to, '')), '') is not null)
       or (new.verified_at is distinct from old.verified_at and new.verified_at is not null) then
      v_act := 1;
      v_cambio := true;
    end if;
  end if;
  if not v_cambio then return new; end if;

  begin
    perform public.koda_registrar(new.id, v_estado, null, false, v_act);
  exception when others then
    raise warning 'koda aprendizaje: %', sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists trg_prospects_aprender on public.prospects;
create trigger trg_prospects_aprender
  after insert or update of status, assigned_to, verified_at on public.prospects
  for each row execute function public.trg_prospects_aprender();

-- Abrir un enlace del prospecto (web, WhatsApp, Instagram, Maps…) es interés real.
-- Silencioso si el prospecto no es suyo (p. ej. la cuenta propietaria mirando a otro).
create or replace function public.koda_interaccion(p_prospect uuid, p_tipo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_active_member() then
    raise exception 'Sesión no válida.';
  end if;
  if p_tipo is distinct from 'contacto' then
    raise exception 'Tipo de interacción no válido.';
  end if;
  if not exists (select 1 from prospects where id = p_prospect and owner_id = auth.uid()) then
    return;
  end if;
  begin
    perform public.koda_registrar(p_prospect, null, null, false, 1::smallint);
  exception when others then
    raise warning 'koda aprendizaje: %', sqlerrm;
  end;
end $$;

-- ── 2) Pulso en vivo ────────────────────────────────────────────────────────
-- ¿Cuántos prospectos del usuario esperan recalificarse? (el front lo consulta y, si
-- hay, dispara el scorer al instante: así KODA se actualiza sin esperar al cron.)
create or replace function public.koda_pendientes_mios()
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int
    from prospects p
    left join koda_perfil f on f.owner_id = p.owner_id
   where p.owner_id = auth.uid()
     and (p.score_version < coalesce(f.version, 1)
          or p.score_desglose is null
          or p.score_desglose = '{}'::jsonb);
$$;

-- Lo último que KODA aprendió del usuario (para avisarle en el momento).
create or replace function public.koda_ultimo_aprendizaje()
returns table (nombre text, aplicado smallint, features text[], hace_seg int)
language sql stable security definer set search_path = public as $$
  select v.nombre, v.aplicado, v.features, extract(epoch from (clock_timestamp() - v.updated_at))::int
    from koda_veredictos v
   where v.owner_id = auth.uid()
   order by v.updated_at desc
   limit 1;
$$;

-- ── 3) El scorer ve el desglose actual (no reescribe lo que no cambió) ──────
drop function if exists public.koda_pendientes(uuid, int);
create or replace function public.koda_pendientes(p_owner uuid default null, p_limite int default 200)
returns table (
  id uuid, owner_id uuid, score int, plan_sugerido text, score_desglose jsonb,
  nombre text, categoria text, descripcion text, ciudad text
)
language sql stable security definer set search_path = public as $$
  select p.id, p.owner_id, p.score, p.plan_sugerido, p.score_desglose,
         p.nombre, p.categoria, p.descripcion, p.ciudad
    from prospects p
    left join koda_perfil f on f.owner_id = p.owner_id
   where (p_owner is null or p.owner_id = p_owner)
     and (p.score_version < coalesce(f.version, 1)
          or p.score_desglose is null
          or p.score_desglose = '{}'::jsonb)
   order by p.created_at desc
   limit greatest(1, least(coalesce(p_limite, 200), 500));
$$;

-- ── 4) Permisos ─────────────────────────────────────────────────────────────
revoke all on function public.koda_pendientes(uuid, int) from public, anon, authenticated;
grant execute on function public.koda_pendientes(uuid, int) to service_role;

revoke all on function public.koda_interaccion(uuid, text)    from public, anon;
revoke all on function public.koda_pendientes_mios()          from public, anon;
revoke all on function public.koda_ultimo_aprendizaje()       from public, anon;
revoke all on function public.koda_marcar_prospecto(uuid, smallint) from public, anon;
grant execute on function public.koda_interaccion(uuid, text)    to authenticated;
grant execute on function public.koda_pendientes_mios()          to authenticated;
grant execute on function public.koda_ultimo_aprendizaje()       to authenticated;
grant execute on function public.koda_marcar_prospecto(uuid, smallint) to authenticated;
