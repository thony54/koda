// koda-collector (sección 7.1): ejecuta un search_job → raw_records.
// Entrada: { job_id }. Respeta rate limit, controla costo, nunca pierde el crudo.
//
// MULTIUSUARIO: el job pertenece a un dueño (search_jobs.owner_id). Solo el dueño,
// el super_admin o el cron pueden ejecutarlo. La API key de Google es la del DUEÑO
// (cifrada en Vault); el super_admin además puede usar el secreto global.
import { corsHeaders, json } from '../_shared/cors.ts';
import { getAdminClient, requireCaller } from '../_shared/supabaseAdmin.ts';
import { geocodeCity, overpassSearch } from '../_shared/sources/osm.ts';
import { googleTextSearch, GOOGLE_TEXTSEARCH_COST } from '../_shared/sources/googlePlaces.ts';
import { tryPost } from '../_shared/discord.ts';
import { createOwnerCache, getOwnerSecrets, SECRET_GOOGLE } from '../_shared/owners.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const admin = getAdminClient();
  const getOwner = createOwnerCache(admin);
  let runId: string | null = null;
  let ownerId: string | null = null;

  try {
    const caller = await requireCaller(req, admin);
    const { job_id } = await req.json().catch(() => ({}));
    if (!job_id) return json({ error: 'Falta job_id' }, 400);

    // Cargar job + fuente.
    const { data: job, error: jobErr } = await admin
      .from('search_jobs')
      .select('*, sources(nombre, tipo)')
      .eq('id', job_id)
      .maybeSingle();
    if (jobErr || !job) return json({ error: 'Job no encontrado' }, 404);
    ownerId = job.owner_id as string;

    // ── Autorización: service_role se salta RLS, así que se valida aquí ─────
    if (!caller.isAdmin && ownerId !== caller.id) {
      return json({ error: 'No tienes acceso a esta búsqueda.' }, 403);
    }
    const owner = await getOwner(ownerId);
    if (!owner.activo) return json({ error: 'El usuario dueño de esta búsqueda está desactivado.' }, 403);
    if (!owner.isAdmin && !owner.permisos.includes('busquedas')) {
      return json({ error: 'Tu usuario no tiene habilitadas las búsquedas. Pídele al administrador que las active.' }, 403);
    }

    // Crear job_run en estado corriendo (con su dueño).
    const { data: run, error: runErr } = await admin
      .from('job_runs')
      .insert({ job_id, status: 'corriendo', owner_id: ownerId })
      .select('id')
      .single();
    if (runErr) throw runErr;
    runId = run.id;

    const sourceName: string = job.sources?.nombre ?? '';
    const useGoogle = /google/i.test(sourceName);
    const max = job.max_resultados ?? 60;

    // Resolver coordenadas (del job o geocodificando la ciudad).
    let lat = job.lat as number | null;
    let lng = job.lng as number | null;
    if ((lat == null || lng == null) && job.ciudad) {
      const geo = await geocodeCity(job.ciudad);
      if (geo) { lat = geo.lat; lng = geo.lng; }
    }

    let places: { external_id: string; payload: Record<string, unknown> }[] = [];
    let costo = 0;

    if (useGoogle) {
      if (!owner.isAdmin && !owner.permisos.includes('google_places')) {
        throw new Error('Tu usuario no tiene habilitado Google Places. Pídele al administrador que lo active.');
      }

      // API key del dueño; el super_admin puede caer al secreto global del proyecto.
      const secretos = await getOwnerSecrets(admin, ownerId, [SECRET_GOOGLE]);
      const apiKey = secretos[SECRET_GOOGLE] ?? (owner.isAdmin ? Deno.env.get('GOOGLE_PLACES_API_KEY') : undefined);
      if (!apiKey) {
        throw new Error(
          owner.isAdmin
            ? 'Falta la API key de Google Places: agrégala en Configuración → Integraciones.'
            : 'Falta tu API key de Google Places: agrégala en Configuración → Integraciones.',
        );
      }

      // Control de costo mensual POR USUARIO (sección 15).
      const tope = owner.tope ?? Number(Deno.env.get('COSTO_MAX_MENSUAL_USD') ?? '50');
      const ahora = new Date();
      const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1).toISOString();
      const { data: gastoRows } = await admin
        .from('job_runs')
        .select('costo_estimado')
        .eq('owner_id', ownerId)
        .gte('started_at', inicioMes);
      const gasto = (gastoRows ?? []).reduce((a, r) => a + Number(r.costo_estimado ?? 0), 0);
      if (gasto + GOOGLE_TEXTSEARCH_COST > tope) {
        throw new Error(`Tope de costo mensual alcanzado (${tope} USD). Ingesta de Google detenida.`);
      }

      places = await googleTextSearch({ query: job.query, lat: lat ?? undefined, lng: lng ?? undefined, radio: job.radio_metros ?? 15000, max, apiKey });
      costo = GOOGLE_TEXTSEARCH_COST;
    } else {
      // OSM Overpass (gratis). Necesita coordenadas.
      if (lat == null || lng == null) throw new Error('No se pudo geocodificar la ciudad para OSM.');
      places = await overpassSearch({ lat, lng, radio: job.radio_metros ?? 15000, max, categorias: job.categorias ?? undefined });
    }

    // Guardar el crudo sin transformar (nunca perder el crudo).
    if (places.length) {
      const rows = places.map((p) => ({
        run_id: runId,
        source_id: job.source_id,
        owner_id: ownerId,
        external_id: p.external_id,
        payload: p.payload,
      }));
      const { error: rawErr } = await admin.from('raw_records').insert(rows);
      if (rawErr) throw rawErr;
    }

    // Cerrar el run.
    await admin
      .from('job_runs')
      .update({ status: 'ok', finished_at: new Date().toISOString(), encontrados: places.length, costo_estimado: costo })
      .eq('id', runId);
    await admin.from('search_jobs').update({ last_run_at: new Date().toISOString() }).eq('id', job_id);

    return json({ ok: true, run_id: runId, encontrados: places.length, costo });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (runId) {
      await admin.from('job_runs').update({ status: 'error', finished_at: new Date().toISOString(), error_mensaje: msg }).eq('id', runId);
    }

    // Aviso al canal #errores del DUEÑO: intento inmediato (no depende del cron del
    // notifier). Si el dueño no tiene webhook de errores no se encola nada (el error
    // igual queda en el historial de la búsqueda y se muestra en pantalla).
    try {
      const owner = await getOwner(ownerId);
      const url = owner.webhooks.errores;
      if (url || owner.isAdmin) {
        const texto = `⚠️ Collector falló: ${msg}`;
        const enviado = await tryPost(url, texto);
        await admin.from('notifications').insert({
          canal: 'errores',
          owner_id: ownerId,
          payload: { texto },
          status: enviado ? 'enviado' : 'pendiente',
          enviado_at: enviado ? new Date().toISOString() : null,
        });
      }
    } catch (notifErr) {
      console.error('No se pudo avisar el error del collector', notifErr);
    }
    return json({ error: msg }, 500);
  }
});
