-- ============================================================================
-- KODA · 0014_koda_aprende_de_connexo.sql
-- KODA aprende también de lo que pasa en el puente con Connexo (solo la cuenta propietaria).
--
-- Hasta ahora KODA aprendía de 3 cosas: el estado que el usuario le pone a un prospecto, su 👍/👎 y lo
-- que hace con él (enlaces, asignar, verificar). Ahora suma una cuarta, la más real: cómo RESPONDE el
-- negocio cuando le llega su perfil de Connexo. Cada envío es un veredicto sobre ese prospecto:
--
--     Aceptó la prueba (botón «¡Sí, enviar demo!»)            +3   es lo mejor que KODA puede observar
--     Su prueba terminó sin pagar (antes había aceptado)      +1   respondió, aunque no convirtió
--     Lo aprobaste / ya salió el WhatsApp (sin respuesta aún) +1   tú lo juzgaste digno de ofrecerse
--     Respondió «Ver más tarde»                               −1
--     La invitación caducó sin respuesta                      −1
--     Lo descartaste en la revisión                           −1
--     Borrador, pendiente, error, sin plantilla                0   no dicen nada del negocio
--
-- Todo entra por el MISMO camino que lo demás (`koda_registrar`): un veredicto por prospecto, la memoria
-- se corrige con la diferencia (cambiar de estado no cuenta doble), y el scorer recalifica al instante.
-- Valor efectivo: 👍/👎 explícito > lo más fuerte entre «respuesta de Connexo» y «estado» (empata Connexo)
-- > actividad. Así un «Aceptó» pesa más que un simple «Calificado», pero un «Cliente» cerrado por ti no
-- lo borra un «Ver más tarde».
--
-- SOLO la cuenta propietaria aprende de Connexo: si el envío es de un prospecto de otro usuario, no pasa
-- nada (el puente es suyo y nada de eso debe asomarse en la memoria ni en los avisos de nadie más).
--
-- Requiere 0009, 0010, 0012 y 0013. Idempotente. Aplicar con (NUNCA `db push`):
--   npx supabase db query --linked -f supabase/migrations/0014_koda_aprende_de_connexo.sql
-- Orden: migración → push del front (la pantalla Mi espacio lee la columna nueva).
-- ============================================================================

do $$ begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'koda_veredictos') then
    raise exception 'Aplica antes 0009 y 0010.';
  end if;
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'connexo_envios') then
    raise exception 'Aplica antes 0012 y 0013.';
  end if;
end $$;

-- ── 1) Un nuevo origen de veredicto ─────────────────────────────────────────
alter table public.koda_veredictos add column if not exists por_connexo smallint not null default 0;

-- Valor de un estado del puente: positivo = "este tipo de negocio responde", negativo = "no".
-- `p_antes` es el estado anterior del envío: distingue «la prueba terminó» (venía de aceptar) de
-- «la invitación caducó sin respuesta».
create or replace function public.koda_valor_connexo(p_estado text, p_antes text default null)
returns smallint language sql immutable as $$
  select (case p_estado
    when 'aceptado'   then 3
    when 'aprobado'   then 1
    when 'wa_enviado' then 1
    when 'declinado'  then -1
    when 'descartado' then -1
    when 'vencido'    then case when p_antes = 'aceptado' then 1 else -1 end
    else 0                                   -- pendiente, borrador, sin_plantilla, error
  end)::smallint;
$$;

-- ── 2) koda_registrar con la respuesta de Connexo ───────────────────────────
-- Misma firma que en 0010 más `p_connexo` (null = no tocar). Los llamadores existentes no cambian
-- (pasan 5 argumentos y el sexto toma su valor por defecto).
drop function if exists public.koda_registrar(uuid, smallint, smallint, boolean, smallint);

create or replace function public.koda_registrar(
  p_prospect        uuid,
  p_por_estado      smallint,
  p_explicito       smallint,
  p_tocar_explicito boolean,
  p_actividad       smallint default 0,
  p_connexo         smallint default null
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
       and coalesce(p_actividad, 0) = 0
       and coalesce(p_connexo, 0) = 0 then
      return;                                         -- nada que recordar todavía
    end if;
    insert into koda_veredictos (owner_id, prospect_id, nombre, por_estado, explicito, por_actividad, por_connexo, updated_at)
    values (pr.owner_id, pr.id, pr.nombre, coalesce(p_por_estado, 0),
            case when p_tocar_explicito then p_explicito end,
            greatest(0, coalesce(p_actividad, 0)), coalesce(p_connexo, 0), clock_timestamp())
    returning * into v;
  else
    update koda_veredictos
       set por_estado    = coalesce(p_por_estado, por_estado),
           explicito     = case when p_tocar_explicito then p_explicito else explicito end,
           por_actividad = greatest(por_actividad, coalesce(p_actividad, 0)),
           por_connexo   = coalesce(p_connexo, por_connexo),
           nombre        = pr.nombre,
           updated_at    = clock_timestamp()      -- exacto aun dentro de una misma transacción
     where id = v.id
     returning * into v;
  end if;

  -- Valor efectivo: 👍/👎 explícito > lo más fuerte entre Connexo y el estado (empata Connexo) > actividad.
  nuevo := coalesce(
    v.explicito,
    case
      when v.por_connexo <> 0 and abs(v.por_connexo) >= abs(v.por_estado) then v.por_connexo
      when v.por_estado  <> 0                                             then v.por_estado
      else null
    end,
    v.por_actividad
  );

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

revoke all on function public.koda_registrar(uuid, smallint, smallint, boolean, smallint, smallint) from public, anon, authenticated;

-- ── 3) El puente le enseña a KODA ───────────────────────────────────────────
-- Cada vez que Connexo cambia el estado de un envío (lo escribe la Edge Function `koda-connexo` con
-- service_role, por eso no se mira auth.uid()). Solo si el dueño del envío es la cuenta propietaria.
-- Nunca bloquea la operación principal: si el aprendizaje falla, solo avisa.
create or replace function public.trg_connexo_envios_aprender()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.prospect_id is null then return new; end if;                      -- el prospecto ya no existe
  if tg_op = 'UPDATE' and new.estado is not distinct from old.estado then return new; end if;
  if not exists (
    select 1 from profiles p where p.id = new.owner_id and p.es_propietario and p.activo
  ) then
    return new;                                                            -- el puente es solo del propietario
  end if;
  begin
    perform public.koda_registrar(
      new.prospect_id, null, null, false, 0::smallint,
      public.koda_valor_connexo(new.estado, case when tg_op = 'UPDATE' then old.estado end)
    );
  exception when others then
    raise warning 'koda aprendizaje (connexo): %', sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists trg_connexo_envios_aprender on public.connexo_envios;
create trigger trg_connexo_envios_aprender
  after insert or update of estado on public.connexo_envios
  for each row execute function public.trg_connexo_envios_aprender();

-- ── 4) Lo que ya había ──────────────────────────────────────────────────────
-- Los envíos existentes enseñan lo que ya muestran (idempotente: el mismo veredicto no cuenta doble).
do $$
declare r record;
begin
  for r in
    select e.prospect_id, e.estado
      from connexo_envios e
      join profiles p on p.id = e.owner_id and p.es_propietario and p.activo
     where e.prospect_id is not null
  loop
    begin
      perform public.koda_registrar(r.prospect_id, null, null, false, 0::smallint, public.koda_valor_connexo(r.estado, null));
    exception when others then
      raise warning 'koda aprendizaje (connexo): %', sqlerrm;
    end;
  end loop;
end $$;
