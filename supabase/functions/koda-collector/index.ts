// koda-collector (sección 7.1): ejecuta un search_job → raw_records.
// Entrada: { job_id }. Respeta rate limit, controla costo, nunca pierde el crudo.
import { corsHeaders, json } from '../_shared/cors.ts';
import { getAdminClient, requireCaller } from '../_shared/supabaseAdmin.ts';
import { geocodeCity, overpassSearch } from '../_shared/sources/osm.ts';
import { googleTextSearch, GOOGLE_TEXTSEARCH_COST } from '../_shared/sources/googlePlaces.ts';
import { tryPostToChannel } from '../_shared/discord.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const admin = getAdminClient();
  let runId: string | null = null;

  try {
    await requireCaller(req, admin);
    const { job_id } = await req.json().catch(() => ({}));
    if (!job_id) return json({ error: 'Falta job_id' }, 400);

    // Cargar job + fuente.
    const { data: job, error: jobErr } = await admin
      .from('search_jobs')
      .select('*, sources(nombre, tipo)')
      .eq('id', job_id)
      .maybeSingle();
    if (jobErr || !job) return json({ error: 'Job no encontrado' }, 404);

    // Crear job_run en estado corriendo.
    const { data: run, error: runErr } = await admin
      .from('job_runs')
      .insert({ job_id, status: 'corriendo' })
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
      const apiKey = Deno.env.get('GOOGLE_PLACES_API_KEY');
      if (!apiKey) throw new Error('Falta GOOGLE_PLACES_API_KEY en los Secrets.');

      // Control de costo mensual (sección 15).
      const tope = Number(Deno.env.get('COSTO_MAX_MENSUAL_USD') ?? '50');
      const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
      const { data: gastoRows } = await admin
        .from('job_runs')
        .select('costo_estimado')
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
    // Aviso a #koda-errores: intento inmediato (no depende del cron del notifier)
    // y, si el webhook responde, lo marco enviado; si no, queda pendiente en la cola.
    const texto = `⚠️ Collector falló: ${msg}`;
    const enviado = await tryPostToChannel('errores', texto);
    await admin.from('notifications').insert({
      canal: 'errores',
      payload: { texto },
      status: enviado ? 'enviado' : 'pendiente',
      enviado_at: enviado ? new Date().toISOString() : null,
    });
    return json({ error: msg }, 500);
  }
});
