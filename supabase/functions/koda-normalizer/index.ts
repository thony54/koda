// koda-normalizer (sección 7.2): raw_records -> prospects, con dedupe (5.7).
// Toma lotes de 50, normaliza, deduplica, respeta la lista negra de supresión,
// inserta señales y marca para re-scoring (score_desglose vacío).
import { corsHeaders, json } from '../_shared/cors.ts';
import { getAdminClient, requireCaller } from '../_shared/supabaseAdmin.ts';
import {
  cleanName, cleanUrl, toE164EC, instagramHandle, dedupeHash,
} from '../_shared/normalize.ts';

const CIUDADES_OBJETIVO = new Set(['Ibarra', 'Otavalo', 'Quito', 'Guayaquil']);
const RUBROS_CON_PLANTILLA = new Set([
  'restaurant', 'restaurante', 'cafe', 'bar', 'hairdresser', 'barber', 'beauty',
  'veterinary', 'dentist', 'clinic', 'doctors', 'gym', 'fitness_centre', 'real_estate_agency',
]);

interface Parsed {
  external_id: string;
  google_place_id: string | null;
  nombre: string;
  categoria: string | null;
  ciudad: string | null;
  lat: number | null;
  lng: number | null;
  website: string | null;
  instagram: string | null;
  telefono: string | null;
  google_maps_url: string | null;
  rating: number | null;
  reviews_count: number | null;
  cerrado: boolean;
}

function parseOsm(payload: Record<string, unknown>, externalId: string): Parsed | null {
  const tags = (payload.tags ?? {}) as Record<string, string>;
  const nombre = tags.name ?? tags['name:es'] ?? '';
  if (!nombre) return null;
  const lat = (payload.lat as number) ?? (payload.center as { lat: number })?.lat ?? null;
  const lon = (payload.lon as number) ?? (payload.center as { lon: number })?.lon ?? null;
  const categoria = tags.shop ?? tags.amenity ?? tags.craft ?? tags.office ?? null;
  return {
    external_id: externalId,
    google_place_id: null,
    nombre: cleanName(nombre),
    categoria,
    ciudad: tags['addr:city'] ?? null,
    lat, lng: lon,
    website: cleanUrl(tags.website ?? tags['contact:website']),
    instagram: instagramHandle(tags['contact:instagram']),
    telefono: toE164EC(tags.phone ?? tags['contact:phone']),
    google_maps_url: null,
    rating: null,
    reviews_count: null,
    cerrado: false,
  };
}

function parseGoogle(payload: Record<string, unknown>): Parsed | null {
  const nombre = (payload.displayName as { text: string })?.text ?? '';
  if (!nombre) return null;
  const loc = payload.location as { latitude: number; longitude: number } | undefined;
  return {
    external_id: `gplace:${payload.id}`,
    google_place_id: payload.id as string,
    nombre: cleanName(nombre),
    categoria: (payload.primaryType as string) ?? null,
    ciudad: null, // se puede derivar de formattedAddress más adelante
    lat: loc?.latitude ?? null,
    lng: loc?.longitude ?? null,
    website: cleanUrl(payload.websiteUri as string),
    instagram: null,
    telefono: toE164EC((payload.internationalPhoneNumber ?? payload.nationalPhoneNumber) as string),
    google_maps_url: (payload.googleMapsUri as string) ?? null,
    rating: (payload.rating as number) ?? null,
    reviews_count: (payload.userRatingCount as number) ?? null,
    cerrado: payload.businessStatus === 'CLOSED_PERMANENTLY',
  };
}

function deriveSignals(p: Parsed, ciudadJob: string | null): string[] {
  const ciudad = p.ciudad ?? ciudadJob;
  const s: string[] = [];
  if (!p.website) s.push('sin_web');
  if (p.instagram) s.push('ig_o_fb_activo');
  if ((p.reviews_count ?? 0) >= 10) s.push('resenas_10_plus');
  if ((p.rating ?? 0) >= 4.0) s.push('rating_4_plus');
  if (ciudad && CIUDADES_OBJETIVO.has(ciudad)) s.push('ciudad_objetivo');
  if (p.categoria && RUBROS_CON_PLANTILLA.has(p.categoria)) s.push('rubro_con_plantilla');
  if (p.telefono) s.push('contacto_directo');
  if (p.cerrado) s.push('cerrado_permanente');
  if (!p.telefono && !p.website && !p.instagram) s.push('sin_ningun_contacto');
  return s;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const admin = getAdminClient();

  try {
    await requireCaller(req, admin);

    const { data: raws, error } = await admin
      .from('raw_records')
      .select('id, run_id, source_id, external_id, payload')
      .eq('procesado', false)
      .limit(50);
    if (error) throw error;
    if (!raws || raws.length === 0) return json({ ok: true, procesados: 0, nuevos: 0, duplicados: 0 });

    // Lista negra de supresión (5.7 / 4.4).
    const { data: bl } = await admin.from('deletion_requests').select('prospect_hash');
    const blacklist = new Set((bl ?? []).map((r) => r.prospect_hash));

    // Ciudad por run (para señales ciudad_objetivo).
    const runIds = [...new Set(raws.map((r) => r.run_id))];
    const { data: runs } = await admin.from('job_runs').select('id, job_id').in('id', runIds);
    const jobIds = [...new Set((runs ?? []).map((r) => r.job_id))];
    const { data: jobs } = await admin.from('search_jobs').select('id, ciudad, source_id').in('id', jobIds);
    const runToCiudad = new Map<string, string | null>();
    (runs ?? []).forEach((run) => {
      const job = (jobs ?? []).find((j) => j.id === run.job_id);
      runToCiudad.set(run.id, job?.ciudad ?? null);
    });

    let nuevos = 0, duplicados = 0, saltados = 0;
    const perRun = new Map<string, { nuevos: number; duplicados: number }>();
    const bump = (runId: string, key: 'nuevos' | 'duplicados') => {
      const c = perRun.get(runId) ?? { nuevos: 0, duplicados: 0 };
      c[key]++; perRun.set(runId, c);
    };

    for (const raw of raws) {
      const payload = raw.payload as Record<string, unknown>;
      const parsed = raw.external_id?.startsWith('gplace:')
        ? parseGoogle(payload)
        : parseOsm(payload, raw.external_id);

      if (!parsed) { await admin.from('raw_records').update({ procesado: true }).eq('id', raw.id); continue; }

      const ciudadJob = runToCiudad.get(raw.run_id) ?? null;
      const ciudad = parsed.ciudad ?? ciudadJob;
      const hash = await dedupeHash({ nombre: parsed.nombre, ciudad, telefono: parsed.telefono, website: parsed.website, instagram: parsed.instagram });

      if (blacklist.has(hash)) { await admin.from('raw_records').update({ procesado: true }).eq('id', raw.id); saltados++; continue; }

      // Buscar existente por google_place_id o dedupe_hash.
      let existing: { id: string } | null = null;
      if (parsed.google_place_id) {
        const { data } = await admin.from('prospects').select('id').eq('google_place_id', parsed.google_place_id).maybeSingle();
        existing = data;
      }
      if (!existing) {
        const { data } = await admin.from('prospects').select('id').eq('dedupe_hash', hash).maybeSingle();
        existing = data;
      }

      const base = {
        nombre: parsed.nombre,
        categoria: parsed.categoria,
        ciudad,
        lat: parsed.lat,
        lng: parsed.lng,
        website: parsed.website,
        tiene_website: Boolean(parsed.website),
        instagram: parsed.instagram,
        whatsapp: parsed.telefono, // heurística: teléfono publicado sirve de WhatsApp
        google_place_id: parsed.google_place_id,
        google_maps_url: parsed.google_maps_url,
        rating: parsed.rating,
        reviews_count: parsed.reviews_count,
        source_id: raw.source_id,
        last_seen_at: new Date().toISOString(),
        score_desglose: {}, // marca para re-scoring
      };

      let prospectId: string;
      if (existing) {
        await admin.from('prospects').update(base).eq('id', existing.id);
        prospectId = existing.id;
        duplicados++; bump(raw.run_id, 'duplicados');
      } else {
        const { data: ins, error: insErr } = await admin
          .from('prospects')
          .insert({ ...base, dedupe_hash: hash, first_seen_at: new Date().toISOString(), status: 'nuevo' })
          .select('id')
          .single();
        if (insErr) { console.error('insert prospect', insErr.message); continue; }
        prospectId = ins.id;
        nuevos++; bump(raw.run_id, 'nuevos');
      }

      // Señales (idempotente: reemplaza).
      const signals = deriveSignals(parsed, ciudadJob);
      await admin.from('prospect_signals').delete().eq('prospect_id', prospectId);
      if (signals.length) {
        await admin.from('prospect_signals').insert(signals.map((clave) => ({ prospect_id: prospectId, clave })));
      }

      // Contactos (idempotente: reemplaza).
      await admin.from('prospect_contacts').delete().eq('prospect_id', prospectId);
      if (parsed.telefono) {
        await admin.from('prospect_contacts').insert({ prospect_id: prospectId, tipo: 'telefono', valor: parsed.telefono, etiqueta: 'principal' });
      }

      await admin.from('raw_records').update({ procesado: true }).eq('id', raw.id);
    }

    // Actualizar contadores por run.
    for (const [runId, c] of perRun) {
      const { data: cur } = await admin.from('job_runs').select('nuevos, duplicados').eq('id', runId).maybeSingle();
      await admin.from('job_runs').update({
        nuevos: (cur?.nuevos ?? 0) + c.nuevos,
        duplicados: (cur?.duplicados ?? 0) + c.duplicados,
      }).eq('id', runId);
    }

    return json({ ok: true, procesados: raws.length, nuevos, duplicados, saltados });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from('notifications').insert({ canal: 'errores', payload: { texto: `Normalizer falló: ${msg}` } });
    return json({ error: msg }, 500);
  }
});
