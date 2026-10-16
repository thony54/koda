import { Search, X, Sparkles } from 'lucide-react';
import { MultiSelect, type Option } from '@/components/ui';
import type { ProspectFilters, Encontrados } from '@/lib/data/prospects';
import type { ProspectType, ProspectStatus } from '@/types/domain';
import type { ScoreBand } from './ScoreBadge';
import { useCorridaInfo, useFilterFacets } from '@/hooks/useProspects';
import { formatDateTime, timeAgo } from '@/lib/format';

export const TIPO_LABEL: Record<ProspectType, string> = {
  negocio_local: 'Negocio local',
  emprendimiento: 'Emprendimiento',
  empresa: 'Empresa',
  profesional_independiente: 'Profesional',
  creador_contenido: 'Creador',
  organizacion: 'Organización',
};

export const STATUS_LABEL: Record<ProspectStatus, string> = {
  nuevo: 'Nuevo',
  calificado: 'Calificado',
  en_contacto: 'En contacto',
  interesado: 'Interesado',
  negociacion: 'Negociación',
  cliente: 'Cliente',
  descartado: 'Descartado',
  no_contactar: 'No contactar',
};

const BANDA_OPTIONS: Option[] = [
  { value: 'hot', label: '🔥 Caliente' },
  { value: 'good', label: '⭐ Bueno' },
  { value: 'warm', label: '🌱 Tibio' },
  { value: 'cold', label: '💤 Frío' },
];

const TIPO_OPTIONS: Option[] = (Object.keys(TIPO_LABEL) as ProspectType[]).map((v) => ({
  value: v,
  label: TIPO_LABEL[v],
}));

const STATUS_OPTIONS: Option[] = (Object.keys(STATUS_LABEL) as ProspectStatus[]).map((v) => ({
  value: v,
  label: STATUS_LABEL[v],
}));

const WEB_OPTIONS: Option[] = [
  { value: 'no', label: 'Sin web' },
  { value: 'si', label: 'Con web' },
];

const ENCONTRADOS_LABEL: Record<Encontrados, string> = {
  ultima: 'Última búsqueda',
  hoy: 'Hoy',
  '7d': 'Últimos 7 días',
  '30d': 'Últimos 30 días',
};

interface FiltersProps {
  value: ProspectFilters;
  onChange: (next: ProspectFilters) => void;
}

export function Filters({ value, onChange }: FiltersProps) {
  const { data: facets } = useFilterFacets();

  const ciudadOptions: Option[] = (facets?.ciudades ?? []).map((c) => ({ value: c, label: c }));
  const sourceOptions: Option[] = (facets?.sources ?? []).map((s) => ({ value: s, label: s }));
  // Búsquedas del usuario, la más reciente primero, con cuándo corrió.
  const busquedaOptions: Option[] = (facets?.busquedas ?? []).map((b) => ({
    value: b.id,
    label: b.ultima ? `${b.nombre} · ${timeAgo(b.ultima)}` : `${b.nombre} · sin resultados`,
  }));
  const encontradosOptions: Option[] = (Object.keys(ENCONTRADOS_LABEL) as Encontrados[]).map((k) => ({
    value: k,
    label: k === 'ultima' && facets?.ultima ? `Última búsqueda · ${facets.ultima.nombre}` : ENCONTRADOS_LABEL[k],
  }));
  const { data: corrida } = useCorridaInfo(value.corrida);

  const set = <K extends keyof ProspectFilters>(key: K, v: ProspectFilters[K]) =>
    onChange({ ...value, [key]: v });

  const activeCount =
    (value.ciudad?.length ?? 0) +
    (value.tipo?.length ?? 0) +
    (value.banda?.length ?? 0) +
    (value.status?.length ?? 0) +
    (value.source?.length ?? 0) +
    (value.busqueda?.length ?? 0) +
    (value.encontrados ? 1 : 0) +
    (value.corrida ? 1 : 0) +
    (value.soloNuevos ? 1 : 0) +
    (value.tieneWeb ? 1 : 0) +
    (value.search ? 1 : 0);
  const porBusqueda = Boolean(value.busqueda?.length || value.encontrados || value.corrida);

  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      {/* Llegaste desde el historial de una búsqueda: se dice claro qué estás mirando. */}
      {value.corrida && (
        <div className="flex w-full items-center gap-2 rounded-md border border-accent/30 bg-accent/[0.08] px-3.5 py-2 text-[13px]">
          <Sparkles className="h-4 w-4 shrink-0 text-accent-text" />
          <span className="min-w-0 truncate text-ink-secondary">
            Viendo lo que trajo <strong className="font-medium text-ink-primary">{corrida?.nombre ?? 'una búsqueda'}</strong>
            {corrida && <> · {formatDateTime(corrida.started_at)} · {corrida.encontrados} encontrados, {corrida.nuevos} nuevos</>}
          </span>
          <button
            onClick={() => onChange({ ...value, corrida: undefined })}
            className="ml-auto shrink-0 rounded px-2 py-1 text-ink-muted hover:text-ink-primary"
          >
            Ver todo
          </button>
        </div>
      )}

      <div className="relative min-w-[220px] max-w-xs flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
        <input
          value={value.search ?? ''}
          onChange={(e) => set('search', e.target.value || undefined)}
          placeholder="Buscar por nombre o rubro…"
          className="glass-input h-9 w-full rounded-md pl-9 pr-3 text-[13px] text-ink-primary placeholder:text-ink-muted outline-none"
        />
      </div>

      <MultiSelect label="Búsqueda" menuWidth="w-80" options={busquedaOptions} value={value.busqueda ?? []} onChange={(v) => set('busqueda', v.length ? v : undefined)} />
      <MultiSelect
        label="Encontrados"
        menuWidth="w-72"
        options={encontradosOptions}
        value={value.encontrados ? [value.encontrados] : []}
        onChange={(v) => set('encontrados', (v[v.length - 1] as Encontrados) || undefined)}
      />
      {porBusqueda && (
        <button
          type="button"
          aria-pressed={Boolean(value.soloNuevos)}
          onClick={() => set('soloNuevos', value.soloNuevos ? undefined : true)}
          className={`h-9 rounded-md border px-3 text-[13px] transition-colors ${
            value.soloNuevos
              ? 'border-accent bg-accent/15 text-accent-text'
              : 'border-line-strong bg-surface-inset text-ink-secondary hover:text-ink-primary'
          }`}
          title="Solo los prospectos que esa búsqueda trajo por primera vez"
        >
          Solo nuevos
        </button>
      )}
      <MultiSelect label="Ciudad" options={ciudadOptions} value={value.ciudad ?? []} onChange={(v) => set('ciudad', v)} />
      <MultiSelect label="Banda" options={BANDA_OPTIONS} value={value.banda ?? []} onChange={(v) => set('banda', v as ScoreBand[])} />
      <MultiSelect label="Tipo" options={TIPO_OPTIONS} value={value.tipo ?? []} onChange={(v) => set('tipo', v as ProspectType[])} />
      <MultiSelect label="Estado" options={STATUS_OPTIONS} value={value.status ?? []} onChange={(v) => set('status', v as ProspectStatus[])} />
      <MultiSelect label="Web" options={WEB_OPTIONS} value={value.tieneWeb ? [value.tieneWeb] : []} onChange={(v) => set('tieneWeb', (v[v.length - 1] as 'si' | 'no') || undefined)} />
      <MultiSelect label="Fuente" options={sourceOptions} value={value.source ?? []} onChange={(v) => set('source', v)} />

      {activeCount > 0 && (
        <button
          onClick={() => onChange({})}
          className="flex h-9 items-center gap-1.5 rounded-md px-2.5 text-[13px] text-ink-muted transition-colors hover:bg-veil/[0.06] hover:text-ink-primary"
        >
          <X className="h-3.5 w-3.5" /> Limpiar ({activeCount})
        </button>
      )}
    </div>
  );
}
