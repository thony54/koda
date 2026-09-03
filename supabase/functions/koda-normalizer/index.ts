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
  descripcion: string | null;
  direccion: string | null;
  ciudad: string | null;
  lat: number | null;
  lng: number | null;
  website: string | null;
  instagram: string | null;
  facebook: string | null;
  telefono: string | null;
  whatsapp: string | null;
  email: string | null;
  google_maps_url: string | null;
  rating: number | null;
  reviews_count: number | null;
  cerrado: boolean;
}

function pick(tags: Record<string, string>, keys: string[]): string | null {
  for (const k of keys) if (tags[k]) return tags[k];
  return null;
}

function fbHandle(v: string | null): string | null {
  if (!v) return null;
  const m = v.match(/facebook\.com\/([^/?#]+)/i);
  return (m ? m[1] : v).replace(/^@/, '').trim() || null;
}

function parseOsm(payload: Record<string, unknown>, externalId: string): Parsed | null {
  const tags = (payload.tags ?? {}) as Record<string, string>;
  const nombre = tags.name ?? tags['name:es'] ?? '';
  if (!nombre) return null;
  const lat = (payload.lat as number) ?? (payload.center as { lat: number })?.lat ?? null;
  const lon = (payload.lon as number) ?? (payload.center as { lon: number })?.lon ?? null;
  const categoria = tags.shop ?? tags.amenity ?? tags.craft ?? tags.office ?? tags.tourism ?? tags.leisure ?? null;

  // Dirección: calle + número (+ barrio).
  const dirPartes = [
    [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' '),
    tags['addr:suburb'] ?? tags['addr:neighbourhood'],
  ].filter(Boolean);
  const direccion = dirPartes.length ? dirPartes.join(', ') : null;

  // Descripción útil: rubro legible + cocina/marca + horarios.
  const descParts = [
    tags.cuisine ? `Cocina: ${tags.cuisine.replace(/;/g, ', ')}` : null,
    tags.brand ? `Marca: ${tags.brand}` : null,
    tags.opening_hours ? `Horario: ${tags.opening_hours}` : null,
  ].filter(Boolean);

  const telefono = toE164EC(pick(tags, ['contact:phone', 'phone', 'contact:mobile', 'contact:telephone', 'mobile']));
  const whatsapp = toE164EC(pick(tags, ['contact:whatsapp', 'whatsapp']));

  return {
    external_id: externalId,
    google_place_id: null,
    nombre: cleanName(nombre),
    categoria,
    descripcion: descParts.length ? descParts.join(' · ') : null,
    direccion,
    ciudad: tags['addr:city'] ?? null,
    lat, lng: lon,
    website: cleanUrl(pick(tags, ['website', 'contact:website', 'url', 'contact:url'])),
    instagram: instagramHandle(pick(tags, ['contact:instagram', 'instagram'])),
    facebook: fbHandle(pick(tags, ['contact:facebook', 'facebook'])),
    telefono,
    whatsapp: whatsapp ?? telefono, // si no hay WA propio, el teléfono suele serlo en EC
    email: pick(tags, ['contact:email', 'email']),
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
  const addr = (payload.formattedAddress as string) ?? null;
  // Intentar derivar ciudad del texto de dirección (penúltimo segmento).
  let ciudad: string | null = null;
  if (addr) {
    const partes = addr.split(',').map((s) => s.trim());
    if (partes.length >= 2) ciudad = partes[partes.length - 2].replace(/\d{5,}/g, '').trim() || null;
  }
  const tel = toE164EC((payload.internationalPhoneNumber ?? payload.nationalPhoneNumber) as string);
  return {
    external_id: `gplace:${payload.id}`,
    google_place_id: payload.id as string,
    nombre: cleanName(nombre),
    categoria: (payload.primaryType as string) ?? null,
    descripcion: null,
    direccion: addr,
    ciudad,
    lat: loc?.latitude ?? null,
    lng: loc?.longitude ?? null,
    website: cleanUrl(payload.websiteUri as string),
    instagram: null,
    facebook: null,
    telefono: tel,
    whatsapp: tel,
    email: null,
    google_maps_url: (payload.googleMapsUri as string) ?? null,
    rating: (payload.rating as number) ?? null,
    reviews_count: (payload.userRatingCount as number) ?? null,
    cerrado: payload.businessStatus === 'CLOSED_PERMANENTLY',
  };
}

function isLinktree(url: string | null): boolean {
  return Boolean(url && /linktr\.ee|beacons|bio\.link|linktree|campsite\.bio/i.test(url));
}

function deriveSignals(p: Parsed, ciudadJob: string | null): string[] {
  const ciudad = p.ciudad ?? ciudadJob;
  const s: string[] = [];
  if (!p.website) s.push('sin_web');
  if (isLinktree(p.website)) s.push('usa_linktree');
  if (p.instagram || p.facebook) s.push('ig_o_fb_activo');
  if (p.whatsapp) s.push('whatsapp_publico');
  if ((p.reviews_count ?? 0) >= 10) s.push('resenas_10_plus');
  if ((p.rating ?? 0) >= 4.0) s.push('rating_4_plus');
  if (ciudad && CIUDADES_OBJETIVO.has(ciudad)) s.push('ciudad_objetivo');
  if (p.categoria && RUBROS_CON_PLANTILLA.has(p.categoria)) s.push('rubro_con_plantilla');
  if (p.telefono || p.email || p.whatsapp) s.push('contacto_directo');
  if (p.cerrado) s.push('cerrado_permanente');
  if (!p.telefono && !p.email && !p.whatsapp && !p.website && !p.instagram && !p.facebook) s.push('sin_ningun_contacto');
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

    const { data: bl } = await admin.from('deletion_requests').select('prospect_hash');
    const blacklist = new Set((bl ?? []).map((r) => r.prospect_hash));

    const runIds = [...new Set(raws.map((r) => r.run_id))];
    const { data: runs } = await admin.from('job_runs').select('id, job_id').in('id', runIds);
    const jobIds = [...new Set((runs ?? []).map((r) => r.job_id))];
    const { data: jobs } = await admin.from('search_jobs').select('id, ciudad').in('id', jobIds);
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
        descripcion: parsed.descripcion,
        direccion: parsed.direccion,
        ciudad,
        lat: parsed.lat,
        lng: parsed.lng,
        website: parsed.website,
        tiene_website: Boolean(parsed.website),
        usa_linktree: isLinktree(parsed.website),
        instagram: parsed.instagram,
        facebook: parsed.facebook,
        whatsapp: parsed.whatsapp,
        google_place_id: parsed.google_place_id,
        google_maps_url: parsed.google_maps_url,
        rating: parsed.rating,
        reviews_count: parsed.reviews_count,
        source_id: raw.source_id,
        last_seen_at: new Date().toISOString(),
        score_desglose: {},
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
        // Encola aviso a #koda-nuevos. El notifier lo formatea leyendo el prospecto
        // (que para entonces ya habrá pasado por el scorer y tendrá score/plan).
        await admin.from('notifications').insert({ prospect_id: prospectId, canal: 'nuevos', payload: {} });
      }

      const signals = deriveSignals(parsed, ciudadJob);
      await admin.from('prospect_signals').delete().eq('prospect_id', prospectId);
      if (signals.length) {
        await admin.from('prospect_signals').insert(signals.map((clave) => ({ prospect_id: prospectId, clave })));
      }

      // Contactos (idempotente: reemplaza).
      await admin.from('prospect_contacts').delete().eq('prospect_id', prospectId);
      const contactos: { prospect_id: string; tipo: string; valor: string; etiqueta?: string }[] = [];
      if (parsed.telefono) contactos.push({ prospect_id: prospectId, tipo: 'telefono', valor: parsed.telefono, etiqueta: 'principal' });
      if (parsed.whatsapp && parsed.whatsapp !== parsed.telefono) contactos.push({ prospect_id: prospectId, tipo: 'whatsapp', valor: parsed.whatsapp });
      if (parsed.email) contactos.push({ prospect_id: prospectId, tipo: 'email', valor: parsed.email });
      if (contactos.length) await admin.from('prospect_contacts').insert(contactos);

      await admin.from('raw_records').update({ procesado: true }).eq('id', raw.id);
    }

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
