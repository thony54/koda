-- ============================================================================
-- KODA · 0017_agente_whatsapp.sql
-- Agente de respuestas de la Bandeja de WhatsApp (solo el propietario).
--
-- Cuando un negocio escribe, un agente (Claude) redacta la respuesta como un buen vendedor: corta, natural, sin emojis.
-- Arranca en modo SUPERVISADO: deja un BORRADOR que el propietario envía, edita o descarta. KODA aprende de cada decisión
-- (lo que aprueba, lo que corrige y lo que escribe por su cuenta) y, cuando el propietario lo decida, puede pasar a AUTOMÁTICO.
--
--   · wa_agente_config         una sola fila: modo (apagado | supervisado | automatico), modelo, esfuerzo y espera
--   · wa_agente_borradores     cada respuesta propuesta y qué pasó con ella (enviada tal cual, editada, descartada…)
--   · wa_agente_aprendizaje    lo que el propietario respondió de verdad (con el contexto), para imitar su estilo
--   · wa_conversaciones.agente_pausado   el propietario toma un chat y el agente no interviene
--
-- Todo lo que cambia datos pasa por funciones SECURITY DEFINER atómicas; el navegador solo LEE (RLS = propietario) y
-- usa unas pocas funciones (modo, pausar, descartar, resumen). Las Edge Functions `koda-wa-inbox` y `koda-connexo` hacen el resto.
--
-- Requiere 0016. Idempotente. Aplicar con (NUNCA `db push`):
--   npx supabase db query --linked -f supabase/migrations/0017_agente_whatsapp.sql
-- Orden: migración → desplegar `koda-wa-inbox` y `koda-connexo` → push del front → secreto ANTHROPIC_API_KEY.
-- ============================================================================

do $$ begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'wa_mensajes') then
    raise exception 'Aplica antes 0016 (bandeja de WhatsApp).';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'is_propietario') then
    raise exception 'Falta is_propietario() (0008).';
  end if;
end $$;

-- ── 1) Configuración (una sola fila) ────────────────────────────────────────
create table if not exists public.wa_agente_config (
  id          smallint primary key default 1 check (id = 1),
  modo        text not null default 'supervisado' check (modo in ('apagado', 'supervisado', 'automatico')),
  modelo      text not null default 'claude-opus-5-5',
  esfuerzo    text not null default 'medium' check (esfuerzo in ('low', 'medium', 'high')),
  -- Segundos que espera tras el último mensaje del cliente antes de redactar (suele escribir en varios mensajes seguidos).
  espera_seg  integer not null default 12 check (espera_seg between 0 and 60),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id) on delete set null
);
insert into public.wa_agente_config (id) values (1) on conflict (id) do nothing;

-- ── 2) Pausar el agente en un chat ──────────────────────────────────────────
alter table public.wa_conversaciones add column if not exists agente_pausado boolean not null default false;

-- ── 3) Borradores del agente ────────────────────────────────────────────────
create table if not exists public.wa_agente_borradores (
  id                 uuid primary key default uuid_generate_v4(),
  conversacion_id    uuid not null references public.wa_conversaciones(id) on delete cascade,
  -- Mensaje del cliente al que responde (el último cuando se redactó).
  mensaje_id         uuid references public.wa_mensajes(id) on delete set null,
  -- responder: hay texto para enviar · traspasar: el agente no se atreve y se lo deja al propietario (la nota dice por qué)
  accion             text not null check (accion in ('responder', 'traspasar')),
  texto              text,
  intencion          text,
  confianza          text check (confianza in ('alta', 'media', 'baja')),
  nota               text,
  estado             text not null default 'pendiente'
                     check (estado in ('pendiente', 'enviado', 'editado', 'descartado', 'reemplazado', 'automatico')),
  texto_final        text,                                   -- lo que realmente se envió
  mensaje_enviado_id uuid references public.wa_mensajes(id) on delete set null,
  modelo             text,
  uso                jsonb,
  created_at         timestamptz not null default clock_timestamp(),
  resuelto_at        timestamptz,
  resuelto_por       uuid references public.profiles(id) on delete set null
);
-- Un solo borrador vivo por mensaje del cliente (regenerar reemplaza al anterior).
create unique index if not exists wa_agente_borr_msg_uq on public.wa_agente_borradores (mensaje_id)
  where mensaje_id is not null and estado not in ('reemplazado', 'descartado');
create index if not exists wa_agente_borr_conv_idx on public.wa_agente_borradores (conversacion_id, created_at desc);
create index if not exists wa_agente_borr_pend_idx on public.wa_agente_borradores (created_at desc) where estado = 'pendiente';

-- ── 4) Aprendizaje: lo que el propietario responde de verdad ────────────────
create table if not exists public.wa_agente_aprendizaje (
  id              uuid primary key default uuid_generate_v4(),
  created_at      timestamptz not null default now(),
  conversacion_id uuid references public.wa_conversaciones(id) on delete set null,
  -- aprobado: envió el borrador tal cual · editado: lo corrigió · directo: escribió por su cuenta
  origen          text not null check (origen in ('aprobado', 'editado', 'directo')),
  -- Los mensajes previos: [{ d: 'cliente' | 'nosotros', t: '…' }], del más viejo al más nuevo.
  contexto        jsonb not null default '[]'::jsonb,
  texto_agente    text,                                       -- lo que proponía el agente (si proponía algo)
  texto_humano    text not null,                              -- lo que el propietario envió
  intencion       text,
  nicho           text,                                       -- plantilla de Connexo del negocio (gastro, barber…)
  borrador_id     uuid references public.wa_agente_borradores(id) on delete set null,
  -- El mensaje que el propietario envió: hace el aprendizaje idempotente (reintentar el mismo envío no lo duplica).
  mensaje_id      uuid references public.wa_mensajes(id) on delete set null,
  activo          boolean not null default true
);
create index if not exists wa_agente_apr_idx on public.wa_agente_aprendizaje (created_at desc) where activo;
create unique index if not exists wa_agente_apr_msg_uq on public.wa_agente_aprendizaje (mensaje_id) where mensaje_id is not null;

-- ── 5) Acceso: solo el propietario lee; nadie escribe desde el navegador ────
alter table public.wa_agente_config      enable row level security;
alter table public.wa_agente_borradores  enable row level security;
alter table public.wa_agente_aprendizaje enable row level security;
drop policy if exists "wa_agente_config: lectura" on public.wa_agente_config;
create policy "wa_agente_config: lectura" on public.wa_agente_config for select using (public.is_propietario());
drop policy if exists "wa_agente_borradores: lectura" on public.wa_agente_borradores;
create policy "wa_agente_borradores: lectura" on public.wa_agente_borradores for select using (public.is_propietario());
drop policy if exists "wa_agente_aprendizaje: lectura" on public.wa_agente_aprendizaje;
create policy "wa_agente_aprendizaje: lectura" on public.wa_agente_aprendizaje for select using (public.is_propietario());

-- ── 6) Texto comparable (para saber si el propietario cambió el borrador) ───
create or replace function public.wa_agente_norm(p text)
returns text language sql immutable as $$
  select regexp_replace(lower(btrim(coalesce(p, ''))), '\s+', ' ', 'g')
$$;

-- ── 7) Todo lo que el agente necesita saber de un chat, en una sola llamada ──
create or replace function public.wa_agente_contexto(p_conv uuid, p_limite integer default 16)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c      public.wa_conversaciones%rowtype;
  cfg    public.wa_agente_config%rowtype;
  e      public.connexo_envios%rowtype;
  pr     public.prospects%rowtype;
  v_msgs jsonb;
  v_ej   jsonb;
  v_bor  jsonb;
  v_ult  record;
  v_auto integer;
begin
  select * into c from public.wa_conversaciones where id = p_conv;
  if not found then return null; end if;
  select * into cfg from public.wa_agente_config where id = 1;
  if c.envio_id is not null then select * into e from public.connexo_envios where id = c.envio_id; end if;
  if c.prospect_id is not null then select * into pr from public.prospects where id = c.prospect_id; end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.ts, x.seq), '[]'::jsonb) into v_msgs
    from (select m.id, m.seq, m.direccion, m.tipo, m.texto, m.ts,
                 (m.enviado_por is not null) as humano,
                 coalesce((m.extra ->> 'agente')::boolean, false) as agente
            from public.wa_mensajes m
           where m.conversacion_id = c.id and m.tipo <> 'reaction'
           order by m.ts desc, m.seq desc
           limit greatest(coalesce(p_limite, 16), 1)) x;

  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]'::jsonb) into v_ej
    from (select origen, contexto, texto_agente, texto_humano, intencion, nicho, created_at
            from public.wa_agente_aprendizaje where activo
           order by created_at desc limit 60) a;

  select to_jsonb(b) into v_bor
    from (select id, accion, texto, intencion, nota, mensaje_id, created_at
            from public.wa_agente_borradores where conversacion_id = c.id and estado = 'pendiente'
           order by created_at desc limit 1) b;

  select m.id, m.tipo, m.texto, m.ts into v_ult
    from public.wa_mensajes m
   where m.conversacion_id = c.id and m.direccion = 'entrante' and m.tipo <> 'reaction'
   order by m.ts desc, m.seq desc limit 1;

  select count(*)::integer into v_auto
    from public.wa_mensajes m
   where m.conversacion_id = c.id and m.direccion = 'saliente' and coalesce((m.extra ->> 'agente')::boolean, false)
     and m.ts > now() - interval '24 hours';

  return jsonb_build_object(
    'conversacion', jsonb_build_object(
      'id', c.id, 'wa_id', c.wa_id, 'nombre_perfil', c.nombre_perfil, 'negocio', c.negocio,
      'ultimo_entrante_at', c.ultimo_entrante_at, 'pausado', c.agente_pausado, 'envio_id', c.envio_id, 'prospect_id', c.prospect_id),
    'envio', case when e.id is null then null else jsonb_build_object(
      'estado', e.estado, 'rubro', e.rubro, 'theme', e.connexo_theme, 'username', e.connexo_username,
      'categoria', e.categoria, 'ciudad', e.prospect_ciudad, 'nombre', e.prospect_nombre) end,
    'prospecto', case when pr.id is null then null else jsonb_build_object(
      'nombre', pr.nombre, 'rating', pr.rating, 'reviews', pr.reviews_count, 'opt_out', coalesce(pr.opt_out, false),
      'tiene_web', (coalesce(pr.website, '') <> ''), 'tiene_instagram', (coalesce(pr.instagram, '') <> '')) end,
    'config', jsonb_build_object('modo', cfg.modo, 'modelo', cfg.modelo, 'esfuerzo', cfg.esfuerzo, 'espera_seg', cfg.espera_seg),
    'mensajes', v_msgs,
    'ultimo_entrante', case when v_ult.id is null then null else jsonb_build_object('id', v_ult.id, 'tipo', v_ult.tipo, 'texto', v_ult.texto, 'ts', v_ult.ts) end,
    'borrador_pendiente', v_bor,
    'ejemplos', v_ej,
    'respuestas_automaticas_24h', v_auto
  );
end $$;

-- ── 8) Guardar el borrador (idempotente y a prueba de carreras) ─────────────
-- p = { conversacion_id, mensaje_id, accion, texto?, intencion?, confianza?, nota?, modelo?, uso? }
-- No se guarda si el mensaje del cliente ya no es el último (escribió otra cosa mientras se redactaba) o si alguien ya respondió.
create or replace function public.wa_agente_guardar_borrador(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_conv   uuid := nullif(p ->> 'conversacion_id', '')::uuid;
  v_msg    uuid := nullif(p ->> 'mensaje_id', '')::uuid;
  v_accion text := coalesce(nullif(p ->> 'accion', ''), 'responder');
  c        public.wa_conversaciones%rowtype;
  v_ult    record;
  v_id     uuid;
begin
  if v_accion not in ('responder', 'traspasar') then raise exception 'Acción inválida.' using errcode = 'P0001'; end if;
  select * into c from public.wa_conversaciones where id = v_conv for update;
  if not found then raise exception 'Esa conversación no existe.' using errcode = 'P0001'; end if;

  select m.id, m.ts, m.seq into v_ult
    from public.wa_mensajes m
   where m.conversacion_id = c.id and m.direccion = 'entrante' and m.tipo <> 'reaction'
   order by m.ts desc, m.seq desc limit 1;
  if v_ult.id is null then return jsonb_build_object('guardado', false, 'motivo', 'sin_mensaje'); end if;
  if v_msg is not null and v_ult.id <> v_msg then return jsonb_build_object('guardado', false, 'motivo', 'obsoleto'); end if;
  if exists (select 1 from public.wa_mensajes m
              where m.conversacion_id = c.id and m.direccion = 'saliente' and m.tipo <> 'template'
                and (m.ts, m.seq) > (v_ult.ts, v_ult.seq)) then
    return jsonb_build_object('guardado', false, 'motivo', 'respondido');
  end if;

  update public.wa_agente_borradores set estado = 'reemplazado', resuelto_at = clock_timestamp()
   where conversacion_id = c.id and estado = 'pendiente';

  begin
    insert into public.wa_agente_borradores (conversacion_id, mensaje_id, accion, texto, intencion, confianza, nota, modelo, uso)
    values (c.id, coalesce(v_msg, v_ult.id), v_accion, nullif(btrim(coalesce(p ->> 'texto', '')), ''), left(p ->> 'intencion', 40),
            nullif(p ->> 'confianza', ''), left(p ->> 'nota', 400), left(p ->> 'modelo', 60), p -> 'uso')
    returning id into v_id;
  exception when unique_violation then
    return jsonb_build_object('guardado', false, 'motivo', 'duplicado');
  end;
  return jsonb_build_object('guardado', true, 'id', v_id);
end $$;

-- ── 9) Aprender de lo que el propietario envía ──────────────────────────────
-- Se llama tras enviar un texto desde la Bandeja. Si había un borrador pendiente: «aprobado» (idéntico), «editado» (cambió algo)
-- o «directo» (escribió otra cosa sin usarlo). Sin borrador: «directo». Guarda el contexto (los 10 mensajes previos).
create or replace function public.wa_agente_aprender(p_conv uuid, p_texto text, p_borrador uuid, p_msg uuid, p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_txt     text := btrim(coalesce(p_texto, ''));
  b         public.wa_agente_borradores%rowtype;
  v_hay     boolean := false;
  v_usado   boolean := false;
  v_origen  text;
  v_ctx     jsonb;
  v_nicho   text;
  v_ts      timestamptz;
  v_seq     bigint;
  v_id      uuid;
begin
  if v_txt = '' or p_conv is null then return jsonb_build_object('aprendido', false); end if;
  if p_msg is not null and exists (select 1 from public.wa_agente_aprendizaje where mensaje_id = p_msg) then
    return jsonb_build_object('aprendido', false, 'duplicado', true);
  end if;

  -- ¿Qué borrador estaba vivo? El que se usó (si lo dice la pantalla) o, si no, el último pendiente del chat.
  if p_borrador is not null then
    select * into b from public.wa_agente_borradores where id = p_borrador and conversacion_id = p_conv and estado = 'pendiente' for update;
    if found then v_hay := true; v_usado := true; end if;
  end if;
  if not v_hay then
    select * into b from public.wa_agente_borradores where conversacion_id = p_conv and estado = 'pendiente' order by created_at desc limit 1 for update;
    if found then v_hay := true; end if;
  end if;

  if v_hay and v_usado and b.texto is not null and public.wa_agente_norm(b.texto) = public.wa_agente_norm(v_txt) then
    v_origen := 'aprobado';
  elsif v_hay and v_usado then
    v_origen := 'editado';
  else
    v_origen := 'directo';
  end if;

  -- Contexto: los 10 mensajes anteriores al que se acaba de enviar.
  if p_msg is not null then select m.ts, m.seq into v_ts, v_seq from public.wa_mensajes m where m.id = p_msg; end if;
  select coalesce(jsonb_agg(jsonb_build_object('d', case when q.direccion = 'entrante' then 'cliente' else 'nosotros' end,
                                               't', coalesce(nullif(q.texto, ''), '[' || q.tipo || ']')) order by q.ts, q.seq), '[]'::jsonb)
    into v_ctx
    from (select m.direccion, m.texto, m.tipo, m.ts, m.seq
            from public.wa_mensajes m
           where m.conversacion_id = p_conv and m.tipo <> 'reaction'
             and (v_ts is null or (m.ts, m.seq) < (v_ts, v_seq))
           order by m.ts desc, m.seq desc limit 10) q;

  select coalesce(e.connexo_theme, e.rubro) into v_nicho
    from public.wa_conversaciones c join public.connexo_envios e on e.id = c.envio_id where c.id = p_conv;

  insert into public.wa_agente_aprendizaje (conversacion_id, origen, contexto, texto_agente, texto_humano, intencion, nicho, borrador_id, mensaje_id)
  values (p_conv, v_origen, v_ctx, case when v_hay then b.texto end, v_txt, case when v_hay then b.intencion end, v_nicho, case when v_hay then b.id end, p_msg)
  returning id into v_id;

  if v_hay then
    update public.wa_agente_borradores
       set estado = case v_origen when 'aprobado' then 'enviado' when 'editado' then 'editado' else 'descartado' end,
           texto_final = v_txt, mensaje_enviado_id = p_msg, resuelto_at = clock_timestamp(), resuelto_por = p_user
     where id = b.id;
  end if;

  -- Memoria acotada: se conservan los 800 más recientes.
  delete from public.wa_agente_aprendizaje
   where id in (select id from public.wa_agente_aprendizaje order by created_at desc offset 800);

  return jsonb_build_object('aprendido', true, 'origen', v_origen, 'id', v_id);
end $$;

-- ── 10) Envío automático: marcar el borrador y el mensaje ───────────────────
create or replace function public.wa_agente_marcar_automatico(p_borrador uuid, p_msg uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.wa_agente_borradores
     set estado = 'automatico', texto_final = texto, mensaje_enviado_id = p_msg, resuelto_at = clock_timestamp()
   where id = p_borrador and estado = 'pendiente';
  update public.wa_mensajes set extra = coalesce(extra, '{}'::jsonb) || jsonb_build_object('agente', true) where id = p_msg;
end $$;

-- Una nota sobre un borrador que sigue pendiente (p. ej. «no se pudo enviar sola»).
create or replace function public.wa_agente_anotar(p_borrador uuid, p_nota text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.wa_agente_borradores set nota = left(p_nota, 400) where id = p_borrador and estado = 'pendiente';
end $$;

-- ── 11) Lo que sí hace el navegador (solo el propietario) ───────────────────
create or replace function public.wa_agente_modo(p_modo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_propietario() then raise exception 'Sesión no válida.'; end if;
  if p_modo not in ('apagado', 'supervisado', 'automatico') then raise exception 'Modo inválido.'; end if;
  update public.wa_agente_config set modo = p_modo, updated_at = now(), updated_by = auth.uid() where id = 1;
end $$;

create or replace function public.wa_agente_pausar(p_conv uuid, p_valor boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_propietario() then raise exception 'Sesión no válida.'; end if;
  update public.wa_conversaciones set agente_pausado = coalesce(p_valor, true), updated_at = clock_timestamp() where id = p_conv;
end $$;

-- Descartar un borrador sin escribir nada (también es una señal: el agente no acertó).
create or replace function public.wa_agente_descartar(p_borrador uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_propietario() then raise exception 'Sesión no válida.'; end if;
  update public.wa_agente_borradores set estado = 'descartado', resuelto_at = clock_timestamp(), resuelto_por = auth.uid()
   where id = p_borrador and estado = 'pendiente';
end $$;

-- Cuánto ha aprendido y qué tanto acierta (sobre las últimas 30 decisiones del propietario): sirve para decidir cuándo pasar a automático.
create or replace function public.wa_agente_resumen()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ap integer; v_ed integer; v_de integer; v_pend integer; v_total integer; v_auto integer;
begin
  if auth.uid() is null or not public.is_propietario() then raise exception 'Sesión no válida.'; end if;
  select count(*) filter (where estado = 'enviado'), count(*) filter (where estado = 'editado'), count(*) filter (where estado = 'descartado')
    into v_ap, v_ed, v_de
    from (select estado from public.wa_agente_borradores
           where estado in ('enviado', 'editado', 'descartado') order by resuelto_at desc nulls last limit 30) x;
  select count(*)::integer into v_pend from public.wa_agente_borradores where estado = 'pendiente';
  select count(*)::integer into v_total from public.wa_agente_aprendizaje where activo;
  select count(*)::integer into v_auto from public.wa_agente_borradores where estado = 'automatico';
  return jsonb_build_object('aprobados', v_ap, 'editados', v_ed, 'descartados', v_de, 'pendientes', v_pend,
                            'aprendidos', v_total, 'automaticos', v_auto,
                            'acierto', case when v_ap + v_ed + v_de = 0 then null else round(100.0 * v_ap / (v_ap + v_ed + v_de)) end);
end $$;

-- ── 12) Permisos ────────────────────────────────────────────────────────────
revoke all on function public.wa_agente_contexto(uuid, integer)                      from public, anon, authenticated;
revoke all on function public.wa_agente_guardar_borrador(jsonb)                      from public, anon, authenticated;
revoke all on function public.wa_agente_aprender(uuid, text, uuid, uuid, uuid)       from public, anon, authenticated;
revoke all on function public.wa_agente_marcar_automatico(uuid, uuid)                from public, anon, authenticated;
revoke all on function public.wa_agente_anotar(uuid, text)                           from public, anon, authenticated;
grant execute on function public.wa_agente_contexto(uuid, integer)                   to service_role;
grant execute on function public.wa_agente_guardar_borrador(jsonb)                   to service_role;
grant execute on function public.wa_agente_aprender(uuid, text, uuid, uuid, uuid)    to service_role;
grant execute on function public.wa_agente_marcar_automatico(uuid, uuid)             to service_role;
grant execute on function public.wa_agente_anotar(uuid, text)                        to service_role;

revoke all on function public.wa_agente_modo(text)                from public, anon;
revoke all on function public.wa_agente_pausar(uuid, boolean)     from public, anon;
revoke all on function public.wa_agente_descartar(uuid)           from public, anon;
revoke all on function public.wa_agente_resumen()                 from public, anon;
grant execute on function public.wa_agente_modo(text)             to authenticated;
grant execute on function public.wa_agente_pausar(uuid, boolean)  to authenticated;
grant execute on function public.wa_agente_descartar(uuid)        to authenticated;
grant execute on function public.wa_agente_resumen()              to authenticated;

-- ── 13) En vivo: la pantalla ve los borradores y el cambio de modo al instante ──
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.wa_agente_borradores; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.wa_agente_config;     exception when duplicate_object then null; end;
  end if;
end $$;

-- ── 14) Semilla: lo que el propietario YA había respondido a mano ───────────
-- Para que el agente empiece imitando su estilo desde el primer día. Idempotente (no repite lo ya sembrado).
insert into public.wa_agente_aprendizaje (created_at, conversacion_id, origen, contexto, texto_humano, nicho, mensaje_id)
select m.ts, m.conversacion_id, 'directo',
       coalesce((select jsonb_agg(jsonb_build_object('d', case when q.direccion = 'entrante' then 'cliente' else 'nosotros' end,
                                                     't', coalesce(nullif(q.texto, ''), '[' || q.tipo || ']')) order by q.ts, q.seq)
                   from (select x.direccion, x.texto, x.tipo, x.ts, x.seq from public.wa_mensajes x
                          where x.conversacion_id = m.conversacion_id and x.tipo <> 'reaction' and (x.ts, x.seq) < (m.ts, m.seq)
                          order by x.ts desc, x.seq desc limit 10) q), '[]'::jsonb),
       btrim(m.texto),
       (select coalesce(e.connexo_theme, e.rubro) from public.wa_conversaciones c join public.connexo_envios e on e.id = c.envio_id where c.id = m.conversacion_id),
       m.id
  from public.wa_mensajes m
 where m.direccion = 'saliente' and m.tipo = 'text' and m.enviado_por is not null and coalesce(btrim(m.texto), '') <> ''
   and not exists (select 1 from public.wa_agente_aprendizaje a where a.mensaje_id = m.id)
 order by m.ts desc
 limit 200;
