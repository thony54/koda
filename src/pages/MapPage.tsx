import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Map as MapIcon, Loader2 } from 'lucide-react';
import L from 'leaflet';
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import '@/styles/map.css';
import { PageHeader, EmptyState } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui';
import { getMapPoints, type MapPoint } from '@/lib/data/prospects';
import { bandForScore, type ScoreBand } from '@/components/prospects/ScoreBadge';
import { BAND_META } from '@/lib/scoring';
import { useUIStore } from '@/store/uiStore';

/**
 * Mapa base: OpenStreetMap estándar (sin API key). En tema oscuro se oscurece por CSS
 * (ver map.css). Si algún día se contrata un proveedor (MapTiler, Stadia…), basta con
 * poner su URL en VITE_MAP_TILES_URL y se usa tal cual, sin filtro.
 */
const CUSTOM_TILES = (import.meta.env.VITE_MAP_TILES_URL as string | undefined)?.trim() || '';
const TILE_URL = CUSTOM_TILES || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION = CUSTOM_TILES
  ? '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>'
  : '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';

const BANDS: ScoreBand[] = ['hot', 'good', 'warm', 'cold'];
const QUITO: [number, number] = [-0.1807, -78.4678];

/** Lee el color real de la banda (Leaflet pinta con atributos SVG: mejor un valor resuelto). */
function bandColors(): Record<ScoreBand, string> {
  const cs = getComputedStyle(document.documentElement);
  const get = (v: string, fallback: string) => cs.getPropertyValue(v).trim() || fallback;
  return {
    hot: get('--score-hot', '#ffa35d'),
    good: get('--score-good', '#ff6600'),
    warm: get('--score-warm', '#b3754d'),
    cold: get('--score-cold', '#9c8f88'),
  };
}

/** Encuadra el mapa a los puntos visibles cada vez que cambia el filtro. */
function FitToPoints({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 14);
      return;
    }
    map.fitBounds(L.latLngBounds(points), { padding: [56, 56], maxZoom: 15 });
  }, [map, points]);
  return null;
}

export default function MapPage() {
  const { data: points, isLoading } = useQuery({ queryKey: ['map-points'], queryFn: getMapPoints });
  const navigate = useNavigate();
  const theme = useUIStore((s) => s.theme);
  const [city, setCity] = useState<string>('todas');
  const [hidden, setHidden] = useState<Set<ScoreBand>>(new Set());

  // Los colores dependen del tema (en claro las bandas son más profundas).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const colors = useMemo(() => bandColors(), [theme]);

  const cities = useMemo(
    () => ['todas', ...new Set((points ?? []).map((p) => p.ciudad).filter(Boolean) as string[])].sort(),
    [points],
  );
  const inCity = useMemo(
    () => (points ?? []).filter((p) => city === 'todas' || p.ciudad === city),
    [points, city],
  );
  const counts = useMemo(() => {
    const c: Record<ScoreBand, number> = { hot: 0, good: 0, warm: 0, cold: 0 };
    inCity.forEach((p) => { c[bandForScore(p.score)]++; });
    return c;
  }, [inCity]);
  const visible = useMemo(
    () => inCity.filter((p) => !hidden.has(bandForScore(p.score))),
    [inCity, hidden],
  );
  const coords = useMemo<[number, number][]>(() => visible.map((p) => [p.lat, p.lng]), [visible]);

  function toggleBand(b: ScoreBand) {
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(b)) n.delete(b);
      else n.add(b);
      return n;
    });
  }

  return (
    <div>
      <PageHeader
        eyebrow="Geolocalización"
        title="Mapa"
        description="Prospectos sobre el mapa, con color por banda de score."
        actions={
          <select
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="glass-input h-9 cursor-pointer appearance-none rounded-md px-3 text-[13px] text-ink-primary outline-none"
            aria-label="Ciudad"
          >
            {cities.map((c) => <option key={c} value={c}>{c === 'todas' ? 'Todas las ciudades' : c}</option>)}
          </select>
        }
      />

      {isLoading ? (
        <div className="grid place-items-center py-24 text-ink-muted"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (points ?? []).length === 0 ? (
        <EmptyState
          icon={<MapIcon className="h-6 w-6" />}
          title="Nada que mapear todavía"
          hint="Cuando los prospectos tengan coordenadas, aparecerán aquí coloreados por banda de score."
        />
      ) : (
        <Card padding="none" className="overflow-hidden">
          {/* Leyenda interactiva: clic para ocultar/mostrar una banda */}
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
            {BANDS.map((b) => {
              const off = hidden.has(b);
              return (
                <button
                  key={b}
                  type="button"
                  onClick={() => toggleBand(b)}
                  aria-pressed={!off}
                  className={`inline-flex h-8 items-center gap-2 rounded-md border px-2.5 text-xs transition-colors ${
                    off
                      ? 'border-line text-ink-muted hover:text-ink-secondary'
                      : 'border-line-strong bg-surface-elevated/60 text-ink-primary hover:border-accent/45'
                  }`}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{
                      backgroundColor: off ? 'transparent' : colors[b],
                      boxShadow: off ? `inset 0 0 0 1.5px ${colors[b]}` : `0 0 8px ${colors[b]}`,
                    }}
                  />
                  {BAND_META[b].label}
                  <span className="num text-ink-muted">{counts[b]}</span>
                </button>
              );
            })}
            <span className="num ml-auto text-xs text-ink-muted">
              {visible.length} de {inCity.length} prospectos
            </span>
          </div>

          <div className="h-[min(62vh,620px)] min-h-[380px] w-full">
            <MapContainer
              center={QUITO}
              zoom={7}
              minZoom={3}
              scrollWheelZoom
              className={`koda-map h-full w-full ${theme === 'dark' && !CUSTOM_TILES ? 'koda-map--dark' : ''}`}
            >
              <TileLayer url={TILE_URL} maxZoom={19} attribution={TILE_ATTRIBUTION} />
              <FitToPoints points={coords} />
              {visible.map((p) => (
                <Pin key={p.id} p={p} color={colors[bandForScore(p.score)]} onOpen={() => navigate(`/prospectos/${p.id}`)} />
              ))}
            </MapContainer>
          </div>
        </Card>
      )}

      <p className="mt-3 text-xs text-ink-muted">
        Clic en un punto para abrir la ficha del prospecto. Solo aparecen los que tienen coordenadas.
      </p>
    </div>
  );
}

function Pin({ p, color, onOpen }: { p: MapPoint; color: string; onOpen: () => void }) {
  const band = bandForScore(p.score);
  return (
    <CircleMarker
      center={[p.lat, p.lng]}
      radius={band === 'hot' ? 8 : 6.5}
      pathOptions={{
        color: 'rgba(0,0,0,0.55)',
        weight: 1.5,
        fillColor: color,
        fillOpacity: 0.9,
        className: band === 'hot' ? 'koda-pin-hot' : undefined,
      }}
      eventHandlers={{
        click: onOpen,
        mouseover: (e) => e.target.setStyle({ weight: 3, color }),
        mouseout: (e) => e.target.setStyle({ weight: 1.5, color: 'rgba(0,0,0,0.55)' }),
      }}
    >
      <Tooltip className="koda-tip" direction="top" offset={[0, -8]} opacity={1}>
        <div className="text-[13px] font-semibold">{p.nombre}</div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] opacity-70">
          <span className="capitalize">{p.categoria ?? 'sin rubro'}</span>
          {p.ciudad && <span>· {p.ciudad}</span>}
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
          <span style={{ color }} className="font-medium">{BAND_META[band].label}</span>
          <span className="num opacity-70">{p.score}/100</span>
        </div>
      </Tooltip>
    </CircleMarker>
  );
}
