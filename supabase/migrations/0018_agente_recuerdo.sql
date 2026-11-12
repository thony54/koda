-- ============================================================================
-- KODA · 0018_agente_recuerdo.sql
-- Motor de RECUERDO del agente de la Bandeja: responde sin IA y sin costo, con un BANCO de respuestas.
--
-- El agente de 0017 redactaba con Claude (pide clave de Anthropic y cuesta). Este motor contesta con lo que Connexo ya sabe y con
-- lo que el propietario ya respondió: busca en un banco la respuesta que encaja, la personaliza y la deja de borrador. Aprende de
-- cada cosa que el propietario envía y, entrada por entrada, gana la confianza para ir en automático. Claude queda como opción
-- («claude» o «mixto»: banco primero, y Claude solo si el banco no reconoce la pregunta).
--
--   · wa_agente_config.motor     recuerdo (por defecto, gratis) | claude | mixto
--   · wa_agente_banco            las respuestas: frases con que la gente pregunta, variantes, acción, historial de aciertos
--   · wa_agente_borradores.banco_id   qué entrada del banco produjo cada borrador (para contar sus aciertos)
--
-- Reglas del banco (las aplica el código; aquí solo se guardan los números):
--   · una respuesta puede ir en AUTOMÁTICO si el propietario la verificó o si la aprobó 3 veces sin cambios y sin más correcciones
--     que la mitad de sus aprobaciones; lo delicado (facturas, quejas, bajas…) es siempre «traspasar» y nunca va solo.
--   · lo de fábrica se siembra desde el código (`agente_banco_sembrar`, idempotente): no pisa lo que el propietario editó ni lo aprendido.
--
-- Requiere 0017. Idempotente. Aplicar con (NUNCA `db push`):
--   npx supabase db query --linked -f supabase/migrations/0018_agente_recuerdo.sql
-- Orden: migración → desplegar `koda-wa-inbox` y `koda-connexo` → `agente_banco_sembrar` (una vez) → push del front.
-- ============================================================================

do $$ begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'wa_agente_borradores') then
    raise exception 'Aplica antes 0017 (agente de la Bandeja).';
  end if;
end $$;

-- ── 1) Motor elegido ────────────────────────────────────────────────────────
alter table public.wa_agente_config add column if not exists motor text not null default 'recuerdo'
  check (motor in ('recuerdo', 'claude', 'mixto'));

-- ── 2) El banco de respuestas ───────────────────────────────────────────────
create table if not exists public.wa_agente_banco (
  id            uuid primary key default uuid_generate_v4(),
  -- Identificador estable de las de fábrica (para actualizarlas sin duplicar); null en las aprendidas y las escritas a mano.
  clave         text unique,
  titulo        text not null check (char_length(titulo) between 1 and 120),
  intencion     text not null default 'otro',
  -- responder: hay texto · traspasar: se deja al propietario con una nota · omitir: no se contesta
  accion        text not null default 'responder' check (accion in ('responder', 'traspasar', 'omitir')),
  -- Cómo lo preguntan: lo que se compara con el mensaje del cliente.
  disparadores  text[] not null default '{}',
  excluye       text[] not null default '{}',
  -- [{ t: 'texto con {marcas}', o: 'fabrica' | 'aprendida' | 'manual' }]
  respuestas    jsonb not null default '[]'::jsonb,
  -- Etapas de la demo (estado del envío) en que aplica; null = todas.
  estados       text[],
  cierre        boolean not null default true,
  nota          text,
  origen        text not null default 'fabrica' check (origen in ('fabrica', 'aprendida', 'manual')),
  verificada    boolean not null default false,
  activo        boolean not null default true,
  -- El propietario la editó: la actualización de fábrica ya no la pisa.
  editada       boolean not null default false,
  usos          integer not null default 0,
  aprobados     integer not null default 0,
  editados      integer not null default 0,
  descartes     integer not null default 0,
  ultimo_uso    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles(id) on delete set null
);
create index if not exists wa_agente_banco_activo_idx on public.wa_agente_banco (created_at) where activo;

alter table public.wa_agente_borradores add column if not exists banco_id uuid references public.wa_agente_banco(id) on delete set null;
create index if not exists wa_agente_borr_banco_idx on public.wa_agente_borradores (banco_id) where banco_id is not null;

alter table public.wa_agente_banco enable row level security;
drop policy if exists "wa_agente_banco: lectura" on public.wa_agente_banco;
create policy "wa_agente_banco: lectura" on public.wa_agente_banco for select using (public.is_propietario());

-- ── 3) El agente lee su configuración (ahora con el motor) ──────────────────
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
    'config', jsonb_build_object('modo', cfg.modo, 'modelo', cfg.modelo, 'esfuerzo', cfg.esfuerzo, 'espera_seg', cfg.espera_seg, 'motor', cfg.motor),
    'mensajes', v_msgs,
    'ultimo_entrante', case when v_ult.id is null then null else jsonb_build_object('id', v_ult.id, 'tipo', v_ult.tipo, 'texto', v_ult.texto, 'ts', v_ult.ts) end,
    'borrador_pendiente', v_bor,
    'ejemplos', v_ej,
    'respuestas_automaticas_24h', v_auto
  );
end $$;

-- ── 4) Guardar el borrador (ahora con la entrada del banco que lo produjo) ──
create or replace function public.wa_agente_guardar_borrador(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_conv   uuid := nullif(p ->> 'conversacion_id', '')::uuid;
  v_msg    uuid := nullif(p ->> 'mensaje_id', '')::uuid;
  v_accion text := coalesce(nullif(p ->> 'accion', ''), 'responder');
  v_banco  uuid;
  c        public.wa_conversaciones%rowtype;
  v_ult    record;
  v_id     uuid;
begin
  if v_accion not in ('responder', 'traspasar') then raise exception 'Acción inválida.' using errcode = 'P0001'; end if;
  select * into c from public.wa_conversaciones where id = v_conv for update;
  if not found then raise exception 'Esa conversación no existe.' using errcode = 'P0001'; end if;

  -- Solo si esa entrada sigue existiendo (el propietario pudo borrarla mientras tanto).
  select b.id into v_banco from public.wa_agente_banco b where b.id = nullif(p ->> 'banco_id', '')::uuid;

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
    insert into public.wa_agente_borradores (conversacion_id, mensaje_id, accion, texto, intencion, confianza, nota, modelo, uso, banco_id)
    values (c.id, coalesce(v_msg, v_ult.id), v_accion, nullif(btrim(coalesce(p ->> 'texto', '')), ''), left(p ->> 'intencion', 40),
            nullif(p ->> 'confianza', ''), left(p ->> 'nota', 400), left(p ->> 'modelo', 60), p -> 'uso', v_banco)
    returning id into v_id;
  exception when unique_violation then
    return jsonb_build_object('guardado', false, 'motivo', 'duplicado');
  end;
  return jsonb_build_object('guardado', true, 'id', v_id);
end $$;

-- ── 5) Aprender de lo que el propietario envía (ahora también cuenta los aciertos del banco) ──
-- Devuelve lo que el código necesita para decidir qué guardar en el banco (el contexto, la entrada que respondió, su nombre…).
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
  v_banco   uuid;
  v_perfil  text;
  v_neg     text;
begin
  if v_txt = '' or p_conv is null then return jsonb_build_object('aprendido', false); end if;
  if p_msg is not null and exists (select 1 from public.wa_agente_aprendizaje where mensaje_id = p_msg) then
    return jsonb_build_object('aprendido', false, 'duplicado', true);
  end if;

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

  if p_msg is not null then select m.ts, m.seq into v_ts, v_seq from public.wa_mensajes m where m.id = p_msg; end if;
  select coalesce(jsonb_agg(jsonb_build_object('d', case when q.direccion = 'entrante' then 'cliente' else 'nosotros' end,
                                               't', coalesce(nullif(q.texto, ''), '[' || q.tipo || ']')) order by q.ts, q.seq), '[]'::jsonb)
    into v_ctx
    from (select m.direccion, m.texto, m.tipo, m.ts, m.seq
            from public.wa_mensajes m
           where m.conversacion_id = p_conv and m.tipo <> 'reaction'
             and (v_ts is null or (m.ts, m.seq) < (v_ts, v_seq))
           order by m.ts desc, m.seq desc limit 10) q;

  select coalesce(e.connexo_theme, e.rubro), c.nombre_perfil, c.negocio into v_nicho, v_perfil, v_neg
    from public.wa_conversaciones c left join public.connexo_envios e on e.id = c.envio_id where c.id = p_conv;

  insert into public.wa_agente_aprendizaje (conversacion_id, origen, contexto, texto_agente, texto_humano, intencion, nicho, borrador_id, mensaje_id)
  values (p_conv, v_origen, v_ctx, case when v_hay then b.texto end, v_txt, case when v_hay then b.intencion end, v_nicho, case when v_hay then b.id end, p_msg)
  returning id into v_id;

  if v_hay then
    update public.wa_agente_borradores
       set estado = case v_origen when 'aprobado' then 'enviado' when 'editado' then 'editado' else 'descartado' end,
           texto_final = v_txt, mensaje_enviado_id = p_msg, resuelto_at = clock_timestamp(), resuelto_por = p_user
     where id = b.id;
    -- Si ese borrador salió del banco, su entrada suma el resultado: aprobada sin cambios, corregida, o ignorada (escribió otra cosa).
    v_banco := b.banco_id;
    if v_banco is not null then
      update public.wa_agente_banco
         set usos = usos + 1,
             aprobados = aprobados + (v_origen = 'aprobado')::int,
             editados  = editados  + (v_origen = 'editado')::int,
             descartes = descartes + (v_origen = 'directo')::int,
             ultimo_uso = now()
       where id = v_banco;
    end if;
  end if;

  delete from public.wa_agente_aprendizaje
   where id in (select id from public.wa_agente_aprendizaje order by created_at desc offset 800);

  return jsonb_build_object('aprendido', true, 'origen', v_origen, 'id', v_id, 'banco_id', v_banco, 'contexto', v_ctx,
                            'texto_agente', case when v_hay then b.texto end, 'nombre_perfil', v_perfil, 'negocio', v_neg);
end $$;

-- ── 6) Descartar un borrador también cuenta contra su entrada del banco ─────
create or replace function public.wa_agente_descartar(p_borrador uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_banco uuid;
begin
  if auth.uid() is null or not public.is_propietario() then raise exception 'Sesión no válida.'; end if;
  update public.wa_agente_borradores set estado = 'descartado', resuelto_at = clock_timestamp(), resuelto_por = auth.uid()
   where id = p_borrador and estado = 'pendiente'
  returning banco_id into v_banco;
  if v_banco is not null then
    update public.wa_agente_banco set usos = usos + 1, descartes = descartes + 1, ultimo_uso = now() where id = v_banco;
  end if;
end $$;

-- ── 7) El banco, para el motor ──────────────────────────────────────────────
create or replace function public.wa_agente_banco_activo()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b.id, 'clave', b.clave, 'titulo', b.titulo, 'intencion', b.intencion, 'accion', b.accion,
           'disparadores', to_jsonb(b.disparadores), 'excluye', to_jsonb(b.excluye), 'respuestas', b.respuestas,
           'estados', case when b.estados is null then null else to_jsonb(b.estados) end, 'cierre', b.cierre, 'nota', b.nota,
           'verificada', b.verificada, 'activo', b.activo, 'origen', b.origen, 'usos', b.usos,
           'aprobados', b.aprobados, 'editados', b.editados, 'descartes', b.descartes) order by b.created_at, b.clave), '[]'::jsonb)
    from public.wa_agente_banco b
   where b.activo
$$;

-- ── 8) Sembrar las respuestas de fábrica (idempotente: no pisa lo editado ni lo aprendido) ──
-- p = [{ clave, titulo, intencion, accion, disparadores[], excluye[], respuestas[] (textos), estados[]|null, cierre, nota }]
create or replace function public.wa_agente_banco_sembrar(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s     jsonb;
  v_n   integer := 0;
begin
  if jsonb_typeof(p) <> 'array' then raise exception 'Se esperaba una lista de respuestas.'; end if;
  for s in select * from jsonb_array_elements(p) loop
    if coalesce(s ->> 'clave', '') = '' or coalesce(s ->> 'titulo', '') = '' then continue; end if;
    v_n := v_n + 1;
    insert into public.wa_agente_banco as b (clave, titulo, intencion, accion, disparadores, excluye, respuestas, estados, cierre, nota, origen)
    values (
      s ->> 'clave', left(s ->> 'titulo', 120), coalesce(nullif(s ->> 'intencion', ''), 'otro'), coalesce(nullif(s ->> 'accion', ''), 'responder'),
      coalesce(array(select jsonb_array_elements_text(coalesce(s -> 'disparadores', '[]'::jsonb))), '{}'),
      coalesce(array(select jsonb_array_elements_text(coalesce(s -> 'excluye', '[]'::jsonb))), '{}'),
      coalesce((select jsonb_agg(jsonb_build_object('t', t, 'o', 'fabrica')) from jsonb_array_elements_text(coalesce(s -> 'respuestas', '[]'::jsonb)) t), '[]'::jsonb),
      case when jsonb_typeof(s -> 'estados') = 'array' then array(select jsonb_array_elements_text(s -> 'estados')) else null end,
      coalesce((s ->> 'cierre')::boolean, coalesce(s ->> 'accion', 'responder') = 'responder'),
      nullif(s ->> 'nota', ''), 'fabrica')
    on conflict (clave) do update set
      titulo = excluded.titulo, intencion = excluded.intencion, accion = excluded.accion, nota = excluded.nota, cierre = excluded.cierre,
      estados = excluded.estados, excluye = excluded.excluye,
      -- Lo que se aprendió (frases y variantes) se conserva y se suma a lo de fábrica.
      disparadores = (select coalesce(array_agg(distinct d), '{}') from unnest(b.disparadores || excluded.disparadores) d),
      respuestas = (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(b.respuestas) x where x ->> 'o' <> 'fabrica') || excluded.respuestas,
      updated_at = now()
    where b.editada = false;
  end loop;
  return jsonb_build_object('semillas', v_n, 'total', (select count(*) from public.wa_agente_banco));
end $$;

-- ── 9) Aprender para el banco: lo que el propietario envió vuelve como variante, frase nueva o entrada nueva ──
-- p = { banco_id?, disparador?, variante?, titulo?, intencion? }
--   con banco_id: agrega la frase y/o la variante a esa entrada (sin duplicar; tope 30 frases y 10 variantes)
--   sin banco_id: crea una entrada nueva (titulo, disparador y variante obligatorios; tope 300 aprendidas)
create or replace function public.wa_agente_banco_aprender(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id    uuid := nullif(p ->> 'banco_id', '')::uuid;
  v_disp  text := nullif(btrim(coalesce(p ->> 'disparador', '')), '');
  v_var   text := nullif(btrim(coalesce(p ->> 'variante', '')), '');
  b       public.wa_agente_banco%rowtype;
  v_idx   integer;
  v_total integer;
begin
  if v_disp is not null and char_length(v_disp) > 160 then v_disp := left(v_disp, 160); end if;
  if v_var is not null and char_length(v_var) > 520 then return jsonb_build_object('ok', false, 'motivo', 'larga'); end if;

  if v_id is not null then
    select * into b from public.wa_agente_banco where id = v_id for update;
    if not found then return jsonb_build_object('ok', false, 'motivo', 'sin_entrada'); end if;
    if b.accion <> 'responder' then return jsonb_build_object('ok', false, 'motivo', 'no_responde'); end if;
    if v_disp is not null and cardinality(b.disparadores) < 30
       and not exists (select 1 from unnest(b.disparadores) d where public.wa_agente_norm(d) = public.wa_agente_norm(v_disp)) then
      b.disparadores := b.disparadores || v_disp;
    end if;
    if v_var is not null
       and not exists (select 1 from jsonb_array_elements(b.respuestas) r where public.wa_agente_norm(r ->> 't') = public.wa_agente_norm(v_var)) then
      b.respuestas := b.respuestas || jsonb_build_array(jsonb_build_object('t', v_var, 'o', 'aprendida'));
      -- Tope de 10 variantes: se descartan las aprendidas más viejas (las de fábrica y las escritas a mano se conservan).
      while jsonb_array_length(b.respuestas) > 10 loop
        select (t.ord - 1)::integer into v_idx from jsonb_array_elements(b.respuestas) with ordinality t(x, ord)
         where t.x ->> 'o' = 'aprendida' order by t.ord limit 1;
        exit when v_idx is null or v_idx >= jsonb_array_length(b.respuestas) - 1;
        b.respuestas := b.respuestas - v_idx;
      end loop;
    end if;
    update public.wa_agente_banco set disparadores = b.disparadores, respuestas = b.respuestas, updated_at = now() where id = b.id;
    return jsonb_build_object('ok', true, 'banco_id', b.id, 'creada', false);
  end if;

  if v_disp is null or v_var is null then return jsonb_build_object('ok', false, 'motivo', 'incompleto'); end if;
  select count(*)::integer into v_total from public.wa_agente_banco where origen = 'aprendida';
  if v_total >= 300 then return jsonb_build_object('ok', false, 'motivo', 'tope'); end if;
  insert into public.wa_agente_banco (titulo, intencion, accion, disparadores, respuestas, cierre, origen)
  values (left(coalesce(nullif(btrim(p ->> 'titulo'), ''), v_disp), 120), coalesce(nullif(p ->> 'intencion', ''), 'aprendida'), 'responder',
          array[v_disp], jsonb_build_array(jsonb_build_object('t', v_var, 'o', 'aprendida')), false, 'aprendida')
  returning id into v_id;
  return jsonb_build_object('ok', true, 'banco_id', v_id, 'creada', true);
end $$;

-- ── 10) Lo que hace el propietario desde la pantalla ────────────────────────
create or replace function public.wa_agente_motor(p_motor text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_propietario() then raise exception 'Sesión no válida.'; end if;
  if p_motor not in ('recuerdo', 'claude', 'mixto') then raise exception 'Motor inválido.'; end if;
  update public.wa_agente_config set motor = p_motor, updated_at = now(), updated_by = auth.uid() where id = 1;
end $$;

-- Crear o editar una respuesta del banco. p = { id?, titulo, intencion?, accion, disparadores[], respuestas[] (textos), estados[]?, cierre, nota?, verificada?, activo? }
create or replace function public.wa_banco_guardar(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id     uuid := nullif(p ->> 'id', '')::uuid;
  v_titulo text := left(btrim(coalesce(p ->> 'titulo', '')), 120);
  v_accion text := coalesce(nullif(p ->> 'accion', ''), 'responder');
  v_disp   text[];
  v_txt    text[];
  v_resp   jsonb;
  v_est    text[];
  b        public.wa_agente_banco%rowtype;
begin
  if auth.uid() is null or not public.is_propietario() then raise exception 'Sesión no válida.'; end if;
  if v_titulo = '' then raise exception 'Ponle un nombre a la respuesta.'; end if;
  if v_accion not in ('responder', 'traspasar', 'omitir') then raise exception 'Acción inválida.'; end if;

  select coalesce(array_agg(x), '{}') into v_disp
    from (select distinct left(btrim(t), 160) as x from jsonb_array_elements_text(coalesce(p -> 'disparadores', '[]'::jsonb)) t where btrim(t) <> '') q;
  if cardinality(v_disp) = 0 then raise exception 'Escribe al menos una frase con la que te lo preguntarían.'; end if;
  if cardinality(v_disp) > 30 then raise exception 'Máximo 30 frases por respuesta.'; end if;

  select coalesce(array_agg(btrim(t)), '{}') into v_txt from jsonb_array_elements_text(coalesce(p -> 'respuestas', '[]'::jsonb)) t where btrim(t) <> '';
  if v_accion = 'responder' and cardinality(v_txt) = 0 then raise exception 'Escribe al menos una respuesta.'; end if;
  if cardinality(v_txt) > 12 then raise exception 'Máximo 12 variantes por respuesta.'; end if;
  if exists (select 1 from unnest(v_txt) t where char_length(t) > 520) then raise exception 'Cada respuesta debe ser de 520 caracteres o menos.'; end if;

  v_est := case when jsonb_typeof(p -> 'estados') = 'array' and jsonb_array_length(p -> 'estados') > 0
                then array(select jsonb_array_elements_text(p -> 'estados')) else null end;

  if v_id is not null then
    select * into b from public.wa_agente_banco where id = v_id for update;
    if not found then raise exception 'Esa respuesta ya no existe.'; end if;
  end if;

  -- Cada variante conserva su origen si el texto no cambió; las nuevas son «manual».
  select coalesce(jsonb_agg(jsonb_build_object('t', t.txt,
           'o', coalesce((select r ->> 'o' from jsonb_array_elements(coalesce(b.respuestas, '[]'::jsonb)) r where r ->> 't' = t.txt limit 1), 'manual')) order by t.ord), '[]'::jsonb)
    into v_resp
    from unnest(v_txt) with ordinality t(txt, ord);

  if v_id is null then
    insert into public.wa_agente_banco (titulo, intencion, accion, disparadores, excluye, respuestas, estados, cierre, nota, origen, verificada, activo, editada, updated_by)
    values (v_titulo, coalesce(nullif(p ->> 'intencion', ''), 'otro'), v_accion, v_disp, '{}', v_resp, v_est,
            coalesce((p ->> 'cierre')::boolean, v_accion = 'responder'), left(nullif(btrim(coalesce(p ->> 'nota', '')), ''), 300), 'manual',
            coalesce((p ->> 'verificada')::boolean, false), coalesce((p ->> 'activo')::boolean, true), true, auth.uid())
    returning id into v_id;
  else
    update public.wa_agente_banco set
      titulo = v_titulo, intencion = coalesce(nullif(p ->> 'intencion', ''), intencion), accion = v_accion, disparadores = v_disp, respuestas = v_resp, estados = v_est,
      cierre = coalesce((p ->> 'cierre')::boolean, cierre), nota = left(nullif(btrim(coalesce(p ->> 'nota', '')), ''), 300),
      verificada = coalesce((p ->> 'verificada')::boolean, verificada), activo = coalesce((p ->> 'activo')::boolean, activo),
      editada = true, updated_at = now(), updated_by = auth.uid()
     where id = v_id;
  end if;
  return v_id;
end $$;

-- Activar/desactivar o verificar una respuesta (sin tocar su texto: lo de fábrica sigue recibiendo mejoras).
create or replace function public.wa_banco_marcar(p_id uuid, p_activo boolean default null, p_verificada boolean default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_propietario() then raise exception 'Sesión no válida.'; end if;
  update public.wa_agente_banco
     set activo = coalesce(p_activo, activo), verificada = coalesce(p_verificada, verificada), updated_at = now(), updated_by = auth.uid()
   where id = p_id;
end $$;

-- Borrar una respuesta. Las de fábrica solo se desactivan (para que se puedan volver a activar); las demás se eliminan.
create or replace function public.wa_banco_borrar(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_origen text;
begin
  if auth.uid() is null or not public.is_propietario() then raise exception 'Sesión no válida.'; end if;
  select origen into v_origen from public.wa_agente_banco where id = p_id;
  if not found then return 'no_existe'; end if;
  if v_origen = 'fabrica' then
    update public.wa_agente_banco set activo = false, updated_at = now(), updated_by = auth.uid() where id = p_id;
    return 'desactivada';
  end if;
  delete from public.wa_agente_banco where id = p_id;
  return 'borrada';
end $$;

-- ── 11) Resumen: ahora también el banco ─────────────────────────────────────
create or replace function public.wa_agente_resumen()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ap integer; v_ed integer; v_de integer; v_pend integer; v_total integer; v_auto integer;
  v_banco integer; v_apr integer; v_conf integer;
begin
  if auth.uid() is null or not public.is_propietario() then raise exception 'Sesión no válida.'; end if;
  select count(*) filter (where estado = 'enviado'), count(*) filter (where estado = 'editado'), count(*) filter (where estado = 'descartado')
    into v_ap, v_ed, v_de
    from (select estado from public.wa_agente_borradores
           where estado in ('enviado', 'editado', 'descartado') order by resuelto_at desc nulls last limit 30) x;
  select count(*)::integer into v_pend from public.wa_agente_borradores where estado = 'pendiente';
  select count(*)::integer into v_total from public.wa_agente_aprendizaje where activo;
  select count(*)::integer into v_auto from public.wa_agente_borradores where estado = 'automatico';
  select count(*)::integer, count(*) filter (where origen = 'aprendida')::integer,
         count(*) filter (where accion = 'responder' and (verificada or (aprobados >= 3 and aprobados >= 2 * (editados + descartes))))::integer
    into v_banco, v_apr, v_conf
    from public.wa_agente_banco where activo;
  return jsonb_build_object('aprobados', v_ap, 'editados', v_ed, 'descartados', v_de, 'pendientes', v_pend,
                            'aprendidos', v_total, 'automaticos', v_auto,
                            'acierto', case when v_ap + v_ed + v_de = 0 then null else round(100.0 * v_ap / (v_ap + v_ed + v_de)) end,
                            'banco', v_banco, 'banco_aprendidas', v_apr, 'banco_confiables', v_conf);
end $$;

-- ── 12) Permisos ────────────────────────────────────────────────────────────
revoke all on function public.wa_agente_banco_activo()           from public, anon, authenticated;
revoke all on function public.wa_agente_banco_sembrar(jsonb)     from public, anon, authenticated;
revoke all on function public.wa_agente_banco_aprender(jsonb)    from public, anon, authenticated;
grant execute on function public.wa_agente_banco_activo()        to service_role;
grant execute on function public.wa_agente_banco_sembrar(jsonb)  to service_role;
grant execute on function public.wa_agente_banco_aprender(jsonb) to service_role;

revoke all on function public.wa_agente_motor(text)                          from public, anon;
revoke all on function public.wa_banco_guardar(jsonb)                        from public, anon;
revoke all on function public.wa_banco_marcar(uuid, boolean, boolean)        from public, anon;
revoke all on function public.wa_banco_borrar(uuid)                          from public, anon;
grant execute on function public.wa_agente_motor(text)                       to authenticated;
grant execute on function public.wa_banco_guardar(jsonb)                     to authenticated;
grant execute on function public.wa_banco_marcar(uuid, boolean, boolean)     to authenticated;
grant execute on function public.wa_banco_borrar(uuid)                       to authenticated;

-- Las funciones redefinidas en esta migración conservan los permisos de 0017 (create or replace no los toca); se reafirman por si acaso.
revoke all on function public.wa_agente_contexto(uuid, integer)                      from public, anon, authenticated;
revoke all on function public.wa_agente_guardar_borrador(jsonb)                      from public, anon, authenticated;
revoke all on function public.wa_agente_aprender(uuid, text, uuid, uuid, uuid)       from public, anon, authenticated;
grant execute on function public.wa_agente_contexto(uuid, integer)                   to service_role;
grant execute on function public.wa_agente_guardar_borrador(jsonb)                   to service_role;
grant execute on function public.wa_agente_aprender(uuid, text, uuid, uuid, uuid)    to service_role;
revoke all on function public.wa_agente_descartar(uuid)                              from public, anon;
revoke all on function public.wa_agente_resumen()                                    from public, anon;
grant execute on function public.wa_agente_descartar(uuid)                           to authenticated;
grant execute on function public.wa_agente_resumen()                                 to authenticated;
