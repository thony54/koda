-- ============================================================================
-- KODA · 0016_whatsapp_bandeja.sql
-- Bandeja de WhatsApp de Connexo, EN VIVO, dentro de KODA (solo el propietario).
--
-- El número de Connexo (+593 99 430 7367) usa la API de WhatsApp: Meta no ofrece bandeja para él, y lo que
-- los negocios responden solo llegaba a Discord. Esta migración guarda cada conversación en la base de KODA
-- para mostrarla en la pantalla «Bandeja» con Supabase Realtime:
--
--   · wa_conversaciones   un chat por celular (wa_id), con vista previa, no leídos y vínculo al envío de Connexo
--   · wa_mensajes         cada mensaje (entrante o saliente) con su estado (enviando → enviado → entregado → leído)
--   · wa_estados_pend     avisos de estado de Meta que llegaron ANTES que su mensaje (carrera); se aplican al llegar
--
-- Todo lo que cambia datos pasa por funciones SECURITY DEFINER atómicas (idempotentes por id de Meta): el
-- navegador solo LEE (RLS = propietario) y marca leído / archivado. Entran por la Edge Function `koda-wa-inbox`
-- (lo que Connexo reenvía del webhook de Meta) y por `koda-connexo` (respuestas del propietario).
--
-- Requiere 0012–0015. Idempotente. Aplicar con (NUNCA `db push`):
--   npx supabase db query --linked -f supabase/migrations/0016_whatsapp_bandeja.sql
-- Orden: migración → desplegar `koda-wa-inbox` y `koda-connexo` → push del front → (Connexo) kodaWhatsApp.
-- ============================================================================

do $$ begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'connexo_envios') then
    raise exception 'Aplica antes 0012 a 0015.';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'is_propietario') then
    raise exception 'Falta is_propietario() (0008).';
  end if;
end $$;

-- ── 1) Conversaciones ───────────────────────────────────────────────────────
create table if not exists public.wa_conversaciones (
  id                 uuid primary key default uuid_generate_v4(),
  -- Celular tal como lo entrega Meta: solo dígitos con código de país (593987654321). Único: un chat por celular.
  wa_id              text not null unique check (wa_id ~ '^[0-9]{8,15}$'),
  nombre_perfil      text,                        -- nombre que el contacto tiene en su WhatsApp
  -- Vínculo con el envío de Connexo (se busca por celular; puede ser NULL si escribe alguien desconocido).
  envio_id           uuid references public.connexo_envios(id) on delete set null,
  prospect_id        uuid references public.prospects(id) on delete set null,
  negocio            text,                        -- nombre del negocio al vincular (sobrevive si se borra el prospecto)
  -- Lo que se ve en la lista. Se actualiza SOLO con mensajes más nuevos que el último (los atrasados no lo pisan).
  ultimo_mensaje_id  uuid,
  ultimo_mensaje_at  timestamptz,
  ultimo_dir         text check (ultimo_dir in ('entrante', 'saliente')),
  ultimo_tipo        text,
  ultimo_texto       text,
  ultimo_estado      text,
  -- Última vez que el contacto escribió: abre la ventana de 24 h en la que se puede responder con texto libre.
  ultimo_entrante_at timestamptz,
  no_leidos          integer not null default 0 check (no_leidos >= 0),
  archivada          boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default clock_timestamp()
);
create index if not exists wa_conv_orden_idx  on public.wa_conversaciones (ultimo_mensaje_at desc nulls last);
create index if not exists wa_conv_envio_idx  on public.wa_conversaciones (envio_id) where envio_id is not null;

-- ── 2) Mensajes ─────────────────────────────────────────────────────────────
create table if not exists public.wa_mensajes (
  id              uuid primary key default uuid_generate_v4(),
  -- Orden de inserción estable: desempata mensajes con la misma hora (Meta da la hora en segundos).
  seq             bigint generated always as identity,
  conversacion_id uuid not null references public.wa_conversaciones(id) on delete cascade,
  wamid           text unique,                    -- id de Meta (NULL mientras se envía)
  client_id       text unique,                    -- id que pone la pantalla al enviar: evita el doble envío al reintentar
  direccion       text not null check (direccion in ('entrante', 'saliente')),
  -- text | image | audio | video | document | sticker | location | contacts | reaction | button | interactive
  -- | template | unsupported
  tipo            text not null default 'text',
  texto           text,                           -- cuerpo, pie de foto o título del botón; en reacciones, el emoji
  media           jsonb,                          -- { id, mime, sha256, nombre, voz, path, bytes, estado: pendiente|guardado|error }
  extra           jsonb,                          -- ubicación, contactos, plantilla, errores de Meta…
  responde_a      text,                           -- wamid del mensaje citado o al que se reacciona
  estado          text not null default 'recibido'
                  check (estado in ('enviando', 'enviado', 'entregado', 'leido', 'fallido', 'recibido')),
  error           text,
  ts              timestamptz not null,           -- hora del mensaje (la de Meta si es entrante)
  enviado_por     uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default clock_timestamp()
);
-- Cuándo cambió por última vez: la pantalla se queda con la versión más nueva si un aviso en vivo y una recarga se cruzan.
alter table public.wa_mensajes add column if not exists actualizado_at timestamptz not null default clock_timestamp();
create or replace function public.wa_mensajes_tocar() returns trigger language plpgsql as $$
begin
  new.actualizado_at := clock_timestamp();
  return new;
end $$;
drop trigger if exists wa_mensajes_tocar on public.wa_mensajes;
create trigger wa_mensajes_tocar before update on public.wa_mensajes for each row execute function public.wa_mensajes_tocar();

create index if not exists wa_msg_hilo_idx on public.wa_mensajes (conversacion_id, ts desc, seq desc);
create index if not exists wa_msg_seq_idx  on public.wa_mensajes (seq);

-- ── 3) Avisos de estado que llegaron antes que su mensaje ───────────────────
-- Meta puede avisar «enviado/entregado» de una respuesta antes de que KODA termine de guardar su id.
create table if not exists public.wa_estados_pend (
  wamid       text primary key,
  estado      text not null,
  rango       smallint not null,
  ts          timestamptz not null,
  error       text,
  created_at  timestamptz not null default now()
);

-- ── 4) Seguridad: el navegador solo lee, y solo el propietario ──────────────
alter table public.wa_conversaciones enable row level security;
alter table public.wa_mensajes       enable row level security;
alter table public.wa_estados_pend   enable row level security;

drop policy if exists "wa_conversaciones: lectura" on public.wa_conversaciones;
create policy "wa_conversaciones: lectura" on public.wa_conversaciones for select using (public.is_propietario());
drop policy if exists "wa_mensajes: lectura" on public.wa_mensajes;
create policy "wa_mensajes: lectura" on public.wa_mensajes for select using (public.is_propietario());
-- wa_estados_pend: sin políticas = nadie del navegador la ve. Sin políticas de escritura en ninguna tabla.

-- ── 5) Funciones de apoyo ───────────────────────────────────────────────────
-- Jerarquía de estados de un mensaje saliente: un aviso atrasado nunca baja de «leído» a «entregado».
create or replace function public.wa_rango(p text)
returns smallint language sql immutable parallel safe as $$
  select case p when 'enviando' then 0 when 'recibido' then 0 when 'enviado' then 1
                when 'entregado' then 2 when 'leido' then 3 when 'fallido' then 4 else 0 end::smallint;
$$;

-- Texto corto para la lista de chats.
create or replace function public.wa_vista_previa(p_tipo text, p_texto text, p_media jsonb, p_extra jsonb)
returns text language sql immutable parallel safe as $$
  select left(btrim(regexp_replace(case p_tipo
    when 'text'        then coalesce(p_texto, '')
    when 'button'      then coalesce(p_texto, 'Botón')
    when 'interactive' then coalesce(p_texto, 'Respuesta')
    when 'image'       then '📷 ' || coalesce(nullif(p_texto, ''), 'Foto')
    when 'video'       then '🎥 ' || coalesce(nullif(p_texto, ''), 'Video')
    when 'audio'       then case when coalesce((p_media->>'voz')::boolean, false) then '🎤 Mensaje de voz' else '🎧 Audio' end
    when 'document'    then '📄 ' || coalesce(nullif(p_media->>'nombre', ''), nullif(p_texto, ''), 'Documento')
    when 'sticker'     then 'Sticker'
    when 'location'    then '📍 Ubicación'
    when 'contacts'    then '👤 Contacto'
    when 'reaction'    then case when coalesce(p_texto, '') = '' then 'Quitó su reacción' else 'Reaccionó ' || p_texto end
    when 'template'    then '📨 ' || coalesce(nullif(p_extra->>'etiqueta', ''), 'Plantilla enviada')
    else 'Mensaje no compatible'
  end, '\s+', ' ', 'g')), 140);
$$;

-- Busca el envío de Connexo de ese celular y lo vincula al chat (si aún no lo está).
create or replace function public.wa_vincular(p_conv uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  c public.wa_conversaciones%rowtype;
  e record;
begin
  select * into c from public.wa_conversaciones where id = p_conv;
  if not found or c.envio_id is not null then return; end if;
  -- Si hay varios envíos con ese celular, manda el que sí recibió el saludo y, entre esos, el más reciente.
  select x.id, x.prospect_id, x.prospect_nombre into e
    from public.connexo_envios x
   where x.whatsapp = '+' || c.wa_id
   order by (x.estado in ('wa_enviado', 'aceptado', 'declinado', 'vencido')) desc, x.actualizado_at desc
   limit 1;
  if found then
    update public.wa_conversaciones
       set envio_id = e.id, prospect_id = e.prospect_id, negocio = e.prospect_nombre, updated_at = clock_timestamp()
     where id = p_conv;
  end if;
end $$;

-- Aplica a un mensaje saliente el aviso de estado que llegó antes que él (y limpia los avisos viejos).
create or replace function public.wa_aplicar_pendiente(p_msg uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  m    public.wa_mensajes%rowtype;
  pend public.wa_estados_pend%rowtype;
begin
  select * into m from public.wa_mensajes where id = p_msg;
  if not found or m.wamid is null then return; end if;
  select * into pend from public.wa_estados_pend where wamid = m.wamid;
  if found then
    if pend.rango > public.wa_rango(m.estado) then
      update public.wa_mensajes
         set estado = pend.estado, error = case when pend.estado = 'fallido' then coalesce(pend.error, error) else error end
       where id = m.id;
      update public.wa_conversaciones set ultimo_estado = pend.estado, updated_at = clock_timestamp()
       where id = m.conversacion_id and ultimo_mensaje_id = m.id;
    end if;
    delete from public.wa_estados_pend where wamid = m.wamid;
  end if;
  delete from public.wa_estados_pend where created_at < now() - interval '3 days';
end $$;

-- ── 6) Entrada de mensajes (webhook de Meta, plantillas enviadas por Connexo) ─
-- p = { wa_id, direccion?, tipo?, texto?, media?, extra?, responde_a?, wamid?, estado?, ts?, nombre? }
-- Idempotente por `wamid`: si Meta reintenta el aviso no se duplica nada. Devuelve { conversacion_id, mensaje_id, duplicado }.
create or replace function public.wa_recibir_mensaje(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_wa     text := regexp_replace(coalesce(p->>'wa_id', ''), '\D', '', 'g');
  v_dir    text := coalesce(nullif(p->>'direccion', ''), 'entrante');
  v_tipo   text := coalesce(nullif(p->>'tipo', ''), 'text');
  v_ts     timestamptz := coalesce(nullif(p->>'ts', '')::timestamptz, clock_timestamp());
  v_wamid  text := nullif(p->>'wamid', '');
  v_estado text;
  v_nombre text := nullif(btrim(coalesce(p->>'nombre', '')), '');
  c        public.wa_conversaciones%rowtype;
  v_id     uuid;
  v_nuevo  boolean;
begin
  if v_wa !~ '^[0-9]{8,15}$' then raise exception 'wa_id inválido' using errcode = 'P0001'; end if;
  if v_dir not in ('entrante', 'saliente') then raise exception 'dirección inválida' using errcode = 'P0001'; end if;
  v_estado := coalesce(nullif(p->>'estado', ''), case when v_dir = 'entrante' then 'recibido' else 'enviado' end);
  if v_estado not in ('enviando', 'enviado', 'entregado', 'leido', 'fallido', 'recibido') then
    raise exception 'estado inválido' using errcode = 'P0001';
  end if;

  -- La conversación se crea si no existe y se bloquea: los mensajes de un mismo chat se aplican de a uno.
  insert into public.wa_conversaciones (wa_id, nombre_perfil) values (v_wa, v_nombre) on conflict (wa_id) do nothing;
  select * into c from public.wa_conversaciones where wa_id = v_wa for update;

  insert into public.wa_mensajes (conversacion_id, wamid, direccion, tipo, texto, media, extra, responde_a, estado, ts)
  values (c.id, v_wamid, v_dir, v_tipo, p->>'texto', p->'media', p->'extra', nullif(p->>'responde_a', ''), v_estado, v_ts)
  on conflict (wamid) do nothing
  returning id into v_id;
  v_nuevo := v_id is not null;

  if not v_nuevo then
    select id into v_id from public.wa_mensajes where wamid = v_wamid;
    return jsonb_build_object('conversacion_id', c.id, 'mensaje_id', v_id, 'duplicado', true);
  end if;

  update public.wa_conversaciones set
    nombre_perfil      = case when v_dir = 'entrante' and v_nombre is not null then v_nombre else nombre_perfil end,
    -- Solo si es el mensaje más reciente (los que llegan atrasados no pisan la vista previa).
    ultimo_mensaje_id  = case when ultimo_mensaje_at is null or v_ts >= ultimo_mensaje_at then v_id else ultimo_mensaje_id end,
    ultimo_dir         = case when ultimo_mensaje_at is null or v_ts >= ultimo_mensaje_at then v_dir else ultimo_dir end,
    ultimo_tipo        = case when ultimo_mensaje_at is null or v_ts >= ultimo_mensaje_at then v_tipo else ultimo_tipo end,
    ultimo_texto       = case when ultimo_mensaje_at is null or v_ts >= ultimo_mensaje_at
                              then public.wa_vista_previa(v_tipo, p->>'texto', p->'media', p->'extra') else ultimo_texto end,
    ultimo_estado      = case when ultimo_mensaje_at is null or v_ts >= ultimo_mensaje_at then v_estado else ultimo_estado end,
    ultimo_mensaje_at  = greatest(coalesce(ultimo_mensaje_at, v_ts), v_ts),
    ultimo_entrante_at = case when v_dir = 'entrante' then greatest(coalesce(ultimo_entrante_at, v_ts), v_ts) else ultimo_entrante_at end,
    -- Los mensajes de historial (`leido: true`, importados de antes de la bandeja) no cuentan como no leídos.
    no_leidos          = no_leidos + case when v_dir = 'entrante' and v_tipo <> 'reaction' and not coalesce((p->>'leido')::boolean, false) then 1 else 0 end,
    archivada          = case when v_dir = 'entrante' then false else archivada end,   -- si escribe, vuelve a la bandeja
    updated_at         = clock_timestamp()
  where id = c.id;

  perform public.wa_vincular(c.id);
  if v_dir = 'saliente' and v_wamid is not null then perform public.wa_aplicar_pendiente(v_id); end if;

  return jsonb_build_object('conversacion_id', c.id, 'mensaje_id', v_id, 'duplicado', false);
end $$;

-- ── 7) Avisos de estado de Meta (enviado / entregado / leído / falló) ───────
-- Sube el estado del mensaje si el nuevo es MÁS avanzado (los avisos pueden llegar desordenados). Si el mensaje aún
-- no existe, el aviso espera en wa_estados_pend. `p_client` permite reconocer una respuesta cuyo id de Meta no se
-- alcanzó a guardar (Meta devuelve el id propio en `biz_opaque_callback_data`).
create or replace function public.wa_registrar_estado(
  p_wamid text, p_estado text, p_ts timestamptz default null, p_error text default null, p_client text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_conv uuid;
  m      public.wa_mensajes%rowtype;
  r      smallint := public.wa_rango(p_estado);
begin
  if p_estado not in ('enviado', 'entregado', 'leido', 'fallido') then
    raise exception 'estado inválido' using errcode = 'P0001';
  end if;

  select conversacion_id into v_conv from public.wa_mensajes
   where (p_wamid is not null and wamid = p_wamid) or (p_client is not null and client_id = p_client)
   limit 1;

  if v_conv is null then
    if p_wamid is null then return jsonb_build_object('aplicado', false, 'pendiente', false); end if;
    insert into public.wa_estados_pend (wamid, estado, rango, ts, error)
    values (p_wamid, p_estado, r, coalesce(p_ts, now()), p_error)
    on conflict (wamid) do update
      set estado = excluded.estado, rango = excluded.rango, ts = excluded.ts, error = excluded.error
    where public.wa_estados_pend.rango < excluded.rango;
    return jsonb_build_object('aplicado', false, 'pendiente', true);
  end if;

  -- Mismo orden de bloqueo que el resto (conversación y luego mensaje): sin interbloqueos.
  perform 1 from public.wa_conversaciones where id = v_conv for update;
  select * into m from public.wa_mensajes
   where (p_wamid is not null and wamid = p_wamid) or (p_client is not null and client_id = p_client)
   limit 1 for update;
  if not found then return jsonb_build_object('aplicado', false, 'pendiente', false); end if;
  if m.direccion <> 'saliente' then return jsonb_build_object('aplicado', false, 'pendiente', false); end if;

  if m.wamid is null and p_wamid is not null then
    update public.wa_mensajes set wamid = p_wamid where id = m.id;
  end if;
  if r > public.wa_rango(m.estado) then
    update public.wa_mensajes
       set estado = p_estado, error = case when p_estado = 'fallido' then coalesce(p_error, error) else error end
     where id = m.id;
    update public.wa_conversaciones set ultimo_estado = p_estado, updated_at = clock_timestamp()
     where id = m.conversacion_id and ultimo_mensaje_id = m.id;
    return jsonb_build_object('aplicado', true, 'pendiente', false);
  end if;
  return jsonb_build_object('aplicado', false, 'pendiente', false);
end $$;

-- ── 8) Responder desde la bandeja ───────────────────────────────────────────
-- Paso 1: registra la respuesta como «enviando» ANTES de llamar a Meta (si algo se corta, queda a la vista) y comprueba
-- las reglas: ventana de 24 h abierta y que el contacto no haya pedido que no le escribamos.
-- `p_client` hace el paso idempotente: reintentar con el mismo id devuelve la misma fila, nunca un segundo mensaje.
-- `p_reintentar` reenvía una respuesta que quedó «fallido».
-- `p_forzar` (botón «Intentar responder igual»): se salta SOLO la comprobación local de la ventana de 24 h, para chats
-- cuyo último mensaje del cliente la bandeja no conoce (escribió antes de existir la bandeja). Meta sigue siendo quien
-- decide: si la ventana está cerrada lo rechaza (131047) y el mensaje queda «fallido» con la explicación. La baja
-- (el negocio pidió no recibir más mensajes) NUNCA se salta.
-- Archivos (fotos, audios, video, documentos): `p_tipo` distinto de 'text' y `p_media` = { path, mime, nombre?, bytes? } con el
-- archivo ya subido al bucket `wa-media` bajo `enviados/<conversación>/`; `p_texto` es el pie (opcional; los audios no llevan).
drop function if exists public.wa_enviar_preparar(uuid, text, text, uuid, uuid, text);
drop function if exists public.wa_enviar_preparar(uuid, text, text, uuid, uuid, text, boolean);
create or replace function public.wa_enviar_preparar(
  p_conv uuid, p_texto text, p_client text, p_user uuid, p_reintentar uuid default null, p_responde_a text default null,
  p_forzar boolean default false, p_tipo text default 'text', p_media jsonb default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c     public.wa_conversaciones%rowtype;
  m     public.wa_mensajes%rowtype;
  v_ts  timestamptz;
  v_id  uuid;
  v_txt text := btrim(coalesce(p_texto, ''));
  v_tipo text := coalesce(nullif(p_tipo, ''), 'text');
  v_media jsonb;
begin
  if v_tipo not in ('text', 'image', 'audio', 'video', 'document') then raise exception 'Tipo de mensaje no admitido.' using errcode = 'P0001'; end if;
  if p_reintentar is not null then
    null;                                       -- el contenido ya está en la fila que se reenvía
  elsif v_tipo = 'text' then
    if v_txt = '' then raise exception 'Escribe un mensaje.' using errcode = 'P0001'; end if;
    if char_length(v_txt) > 4096 then raise exception 'El mensaje supera los 4096 caracteres de WhatsApp.' using errcode = 'P0001'; end if;
  else
    if coalesce(p_media->>'path', '') = '' or p_media->>'path' !~ '^enviados/[0-9a-f-]{36}/[A-Za-z0-9_.-]{1,120}$'
       or p_media->>'path' not like 'enviados/' || p_conv::text || '/%' then
      raise exception 'Falta el archivo a enviar.' using errcode = 'P0001';
    end if;
    if char_length(v_txt) > 1024 then raise exception 'El pie del archivo supera los 1024 caracteres de WhatsApp.' using errcode = 'P0001'; end if;
    if v_tipo = 'audio' then v_txt := ''; end if;                                  -- los audios no llevan texto
    v_media := jsonb_build_object('path', p_media->>'path', 'mime', p_media->>'mime', 'nombre', p_media->>'nombre',
                                  'bytes', p_media->'bytes', 'voz', coalesce((p_media->>'voz')::boolean, false), 'estado', 'guardado');
  end if;
  if coalesce(p_client, '') !~ '^[A-Za-z0-9_-]{8,64}$' then raise exception 'Identificador de envío inválido.' using errcode = 'P0001'; end if;

  select * into c from public.wa_conversaciones where id = p_conv for update;
  if not found then raise exception 'Esa conversación no existe.' using errcode = 'P0001'; end if;

  -- ¿Ya se registró este envío? (reintento por red caída)
  select * into m from public.wa_mensajes where client_id = p_client;
  if found then
    if m.conversacion_id <> c.id then raise exception 'Identificador de envío repetido.' using errcode = 'P0001'; end if;
    return jsonb_build_object('id', m.id, 'wa_id', c.wa_id, 'estado', m.estado, 'wamid', m.wamid, 'ya_existia', true, 'texto', m.texto,
                              'tipo', m.tipo, 'media', m.media);
  end if;

  if not coalesce(p_forzar, false) and (c.ultimo_entrante_at is null or c.ultimo_entrante_at < now() - interval '24 hours') then
    raise exception 'ventana_cerrada: pasaron más de 24 horas desde el último mensaje del cliente; WhatsApp solo permite una plantilla aprobada.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.prospects pr where pr.id = c.prospect_id and pr.opt_out) then
    raise exception 'baja: este negocio pidió no recibir más mensajes.' using errcode = 'P0001';
  end if;

  if p_reintentar is not null then
    select * into m from public.wa_mensajes where id = p_reintentar and conversacion_id = c.id and direccion = 'saliente' for update;
    if not found then raise exception 'No encontré el mensaje a reintentar.' using errcode = 'P0001'; end if;
    -- Se reenvía lo que falló y lo que lleva más de 60 s «enviando» sin confirmación (puede haber salido: la pantalla avisa).
    if not (m.estado = 'fallido' or (m.estado = 'enviando' and m.created_at < clock_timestamp() - interval '60 seconds')) then
      raise exception 'Ese mensaje no falló: no se reenvía.' using errcode = 'P0001';
    end if;
    update public.wa_mensajes set estado = 'enviando', error = null, client_id = p_client, enviado_por = p_user where id = m.id;
    update public.wa_conversaciones set ultimo_estado = 'enviando', updated_at = clock_timestamp()
     where id = c.id and ultimo_mensaje_id = m.id;
    return jsonb_build_object('id', m.id, 'wa_id', c.wa_id, 'estado', 'enviando', 'wamid', null, 'ya_existia', false, 'texto', m.texto,
                              'responde_a', m.responde_a, 'tipo', m.tipo, 'media', m.media);
  end if;

  -- La hora de la respuesta nunca queda antes del último mensaje visible (relojes de Meta y de KODA pueden diferir).
  v_ts := greatest(clock_timestamp(), coalesce(c.ultimo_mensaje_at, '-infinity'::timestamptz) + interval '1 millisecond');
  insert into public.wa_mensajes (conversacion_id, client_id, direccion, tipo, texto, media, responde_a, estado, ts, enviado_por, extra)
  values (c.id, p_client, 'saliente', v_tipo, nullif(v_txt, ''), v_media, nullif(p_responde_a, ''), 'enviando', v_ts, p_user,
          case when coalesce(p_forzar, false) then jsonb_build_object('forzado', true) end)
  returning id into v_id;

  update public.wa_conversaciones set
    ultimo_mensaje_id = v_id, ultimo_mensaje_at = v_ts, ultimo_dir = 'saliente', ultimo_tipo = v_tipo,
    ultimo_texto = public.wa_vista_previa(v_tipo, v_txt, v_media, null), ultimo_estado = 'enviando',
    no_leidos = 0, updated_at = clock_timestamp()                         -- responder equivale a haberlo leído
  where id = c.id;

  return jsonb_build_object('id', v_id, 'wa_id', c.wa_id, 'estado', 'enviando', 'wamid', null, 'ya_existia', false, 'texto', v_txt,
                            'responde_a', nullif(p_responde_a, ''), 'tipo', v_tipo, 'media', v_media);
end $$;

-- Paso 2 (Meta aceptó): guarda el id de Meta y aplica el aviso de estado que se haya adelantado.
create or replace function public.wa_enviar_confirmar(p_id uuid, p_wamid text)
returns void language plpgsql security definer set search_path = public as $$
declare m public.wa_mensajes%rowtype;
begin
  select conversacion_id into m.conversacion_id from public.wa_mensajes where id = p_id;
  if not found then return; end if;
  perform 1 from public.wa_conversaciones where id = m.conversacion_id for update;
  update public.wa_mensajes
     set wamid = coalesce(wamid, p_wamid), estado = case when estado = 'enviando' then 'enviado' else estado end, error = null
   where id = p_id
   returning * into m;
  update public.wa_conversaciones set ultimo_estado = m.estado, updated_at = clock_timestamp()
   where id = m.conversacion_id and ultimo_mensaje_id = m.id;
  perform public.wa_aplicar_pendiente(p_id);
end $$;

-- Paso 2 (falló): queda «fallido» con el motivo, a la vista y con botón de reintentar.
create or replace function public.wa_enviar_fallo(p_id uuid, p_error text)
returns void language plpgsql security definer set search_path = public as $$
declare m public.wa_mensajes%rowtype;
begin
  select conversacion_id into m.conversacion_id from public.wa_mensajes where id = p_id;
  if not found then return; end if;
  perform 1 from public.wa_conversaciones where id = m.conversacion_id for update;
  -- Solo si seguía «enviando»: si un aviso de Meta ya lo marcó enviado, no se pisa.
  update public.wa_mensajes set estado = 'fallido', error = left(coalesce(p_error, 'No se pudo enviar.'), 400)
   where id = p_id and estado = 'enviando' returning * into m;
  if found then
    update public.wa_conversaciones set ultimo_estado = 'fallido', updated_at = clock_timestamp()
     where id = m.conversacion_id and ultimo_mensaje_id = m.id;
  end if;
end $$;

-- Archivo adjunto guardado (o que no se pudo guardar): se anota en el mensaje.
create or replace function public.wa_media_actualizar(p_id uuid, p_media jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.wa_mensajes set media = coalesce(media, '{}'::jsonb) || coalesce(p_media, '{}'::jsonb) where id = p_id;
end $$;

-- ── 9) Lo que sí hace el navegador: marcar leído / no leído / archivar ──────
create or replace function public.wa_marcar_leida(p_conv uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_propietario() then raise exception 'Sesión no válida.'; end if;
  update public.wa_conversaciones set no_leidos = 0, updated_at = clock_timestamp() where id = p_conv and no_leidos <> 0;
end $$;

create or replace function public.wa_marcar_no_leida(p_conv uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_propietario() then raise exception 'Sesión no válida.'; end if;
  update public.wa_conversaciones set no_leidos = greatest(no_leidos, 1), updated_at = clock_timestamp() where id = p_conv;
end $$;

create or replace function public.wa_archivar(p_conv uuid, p_valor boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_propietario() then raise exception 'Sesión no válida.'; end if;
  update public.wa_conversaciones set archivada = coalesce(p_valor, true), updated_at = clock_timestamp() where id = p_conv;
end $$;

-- ── 10) Permisos de las funciones ───────────────────────────────────────────
revoke all on function public.wa_vincular(uuid)                                  from public, anon, authenticated;
revoke all on function public.wa_aplicar_pendiente(uuid)                         from public, anon, authenticated;
revoke all on function public.wa_recibir_mensaje(jsonb)                          from public, anon, authenticated;
revoke all on function public.wa_registrar_estado(text, text, timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.wa_enviar_preparar(uuid, text, text, uuid, uuid, text, boolean, text, jsonb) from public, anon, authenticated;
revoke all on function public.wa_enviar_confirmar(uuid, text)                    from public, anon, authenticated;
revoke all on function public.wa_enviar_fallo(uuid, text)                        from public, anon, authenticated;
revoke all on function public.wa_media_actualizar(uuid, jsonb)                   from public, anon, authenticated;
grant execute on function public.wa_recibir_mensaje(jsonb)                          to service_role;
grant execute on function public.wa_registrar_estado(text, text, timestamptz, text, text) to service_role;
grant execute on function public.wa_enviar_preparar(uuid, text, text, uuid, uuid, text, boolean, text, jsonb) to service_role;
grant execute on function public.wa_enviar_confirmar(uuid, text)                    to service_role;
grant execute on function public.wa_enviar_fallo(uuid, text)                        to service_role;
grant execute on function public.wa_media_actualizar(uuid, jsonb)                   to service_role;

revoke all on function public.wa_marcar_leida(uuid)           from public, anon;
revoke all on function public.wa_marcar_no_leida(uuid)        from public, anon;
revoke all on function public.wa_archivar(uuid, boolean)      from public, anon;
grant execute on function public.wa_marcar_leida(uuid)        to authenticated;
grant execute on function public.wa_marcar_no_leida(uuid)     to authenticated;
grant execute on function public.wa_archivar(uuid, boolean)   to authenticated;

-- ── 11) En vivo: Realtime sobre las dos tablas (respeta RLS: solo el propietario recibe) ──
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.wa_conversaciones; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.wa_mensajes;       exception when duplicate_object then null; end;
  end if;
end $$;

-- ── 12) Archivos de los clientes (fotos, notas de voz, documentos) ──────────
-- Los enlaces de Meta caducan a los pocos minutos y los archivos a los 30 días: se guardan aquí al recibirlos.
-- Bucket PRIVADO; solo el propietario lee (enlaces firmados); escribe únicamente service_role.
do $$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('wa-media', 'wa-media', false, 20971520)
    on conflict (id) do update set public = false, file_size_limit = 20971520;
    drop policy if exists "wa_media: lectura propietario" on storage.objects;
    create policy "wa_media: lectura propietario" on storage.objects for select
      using (bucket_id = 'wa-media' and public.is_propietario());
    -- Lo que el propietario envía (fotos, audios…) lo sube el navegador bajo enviados/<conversación>/ y Meta lo baja con un
    -- enlace firmado de corta vida. Subir y reemplazar (reintento con el mismo nombre) solo ahí y solo el propietario.
    drop policy if exists "wa_media: subida propietario" on storage.objects;
    create policy "wa_media: subida propietario" on storage.objects for insert
      with check (bucket_id = 'wa-media' and public.is_propietario() and name like 'enviados/%');
    drop policy if exists "wa_media: reemplazo propietario" on storage.objects;
    create policy "wa_media: reemplazo propietario" on storage.objects for update
      using (bucket_id = 'wa-media' and public.is_propietario() and name like 'enviados/%')
      with check (bucket_id = 'wa-media' and public.is_propietario() and name like 'enviados/%');
  end if;
end $$;
