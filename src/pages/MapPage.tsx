import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Map as MapIcon, Loader2 } from 'lucide-react';
import { PageHeader, EmptyState } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui';
import { getMapPoints } from '@/lib/data/prospects';
import { bandForScore } from '@/components/prospects/ScoreBadge';
import { SCORE_VAR, BAND_META } from '@/lib/scoring';
import type { ScoreBand } from '@/components/prospects/ScoreBadge';

const W = 800, H = 480, PAD = 30;

export default function MapPage() {
  const { data: points, isLoading } = useQuery({ queryKey: ['map-points'], queryFn: getMapPoints });
  const navigate = useNavigate();
  const [city, setCity] = useState<string>('todas');
  const [hover, setHover] = useState<string | null>(null);

  const cities = useMemo(
    () => ['todas', ...new Set((points ?? []).map((p) => p.ciudad).filter(Boolean) as string[])].sort(),
    [points],
  );
  const filtered = useMemo(
    () => (points ?? []).filter((p) => city === 'todas' || p.ciudad === city),
    [points, city],
  );

  // Proyección lineal simple lat/lng → pixeles (encuadre a los datos filtrados).
  const proj = useMemo(() => {
    if (filtered.length === 0) return null;
    const lats = filtered.map((p) => p.lat), lngs = filtered.map((p) => p.lng);
    let minLat = Math.min(...lats), maxLat = Math.max(...lats);
    let minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    // margen para que no queden pegados al borde / caso de un solo punto
    const padLat = (maxLat - minLat || 0.05) * 0.15, padLng = (maxLng - minLng || 0.05) * 0.15;
    minLat -= padLat; maxLat += padLat; minLng -= padLng; maxLng += padLng;
    return (lat: number, lng: number) => ({
      x: PAD + ((lng - minLng) / (maxLng - minLng)) * (W - 2 * PAD),
      y: PAD + ((maxLat - lat) / (maxLat - minLat)) * (H - 2 * PAD),
    });
  }, [filtered]);

  return (
    <div>
      <PageHeader
        title="Mapa"
        description="Prospectos geolocalizados, color por banda de score."
        actions={
          <select
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="glass-input rounded-md px-3 py-1.5 text-sm text-ink-primary outline-none"
          >
            {cities.map((c) => <option key={c} value={c}>{c === 'todas' ? 'Todas las ciudades' : c}</option>)}
          </select>
        }
      />

      {isLoading ? (
        <div className="grid place-items-center py-20 text-ink-muted"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : filtered.length === 0 || !proj ? (
        <EmptyState icon={<MapIcon className="h-6 w-6" />} title="Nada que mapear todavía" hint="Cuando los prospectos tengan coordenadas, aparecerán aquí coloreados por banda de score." />
      ) : (
        <Card>
          {/* Leyenda */}
          <div className="mb-3 flex flex-wrap gap-4">
            {(Object.keys(BAND_META) as ScoreBand[]).map((b) => (
              <span key={b} className="inline-flex items-center gap-1.5 text-xs text-ink-secondary">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: SCORE_VAR[b] }} />
                {BAND_META[b].emoji} {BAND_META[b].label}
              </span>
            ))}
            <span className="ml-auto text-xs text-ink-muted">{filtered.length} prospectos</span>
          </div>

          <div className="w-full overflow-x-auto rounded-md border border-line bg-surface-base">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 520 }}>
              {filtered.map((p) => {
                const { x, y } = proj(p.lat, p.lng);
                const band = bandForScore(p.score);
                const isHover = hover === p.id;
                return (
                  <g key={p.id} style={{ cursor: 'pointer' }}
                    onMouseEnter={() => setHover(p.id)} onMouseLeave={() => setHover(null)}
                    onClick={() => navigate(`/prospectos/${p.id}`)}>
                    <circle cx={x} cy={y} r={isHover ? 8 : 5} fill={SCORE_VAR[band]} opacity={isHover ? 1 : 0.8} stroke="var(--background-card)" strokeWidth={1.5} />
                    {isHover && (
                      <g>
                        <rect x={x + 10} y={y - 22} width={Math.max(80, p.nombre.length * 6.5)} height={30} rx={4} fill="var(--background-card)" stroke="var(--card-border)" />
                        <text x={x + 16} y={y - 9} fill="var(--text-primary)" fontSize={11} fontWeight="600">{p.nombre}</text>
                        <text x={x + 16} y={y + 3} fill="var(--text-muted)" fontSize={9}>{p.categoria} · {p.score}/100</text>
                      </g>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            Proyección aproximada por coordenadas (sin mapa base). Clic en un punto para abrir la ficha.
          </p>
        </Card>
      )}
    </div>
  );
}
