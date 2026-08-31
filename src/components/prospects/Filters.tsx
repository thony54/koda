import { Search, X } from 'lucide-react';
import { MultiSelect, type Option } from '@/components/ui';
import type { ProspectFilters } from '@/lib/data/prospects';
import type { ProspectType, ProspectStatus } from '@/types/domain';
import type { ScoreBand } from './ScoreBadge';
import { useFilterFacets } from '@/hooks/useProspects';

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

interface FiltersProps {
  value: ProspectFilters;
  onChange: (next: ProspectFilters) => void;
}

export function Filters({ value, onChange }: FiltersProps) {
  const { data: facets } = useFilterFacets();

  const ciudadOptions: Option[] = (facets?.ciudades ?? []).map((c) => ({ value: c, label: c }));
  const sourceOptions: Option[] = (facets?.sources ?? []).map((s) => ({ value: s, label: s }));

  const set = <K extends keyof ProspectFilters>(key: K, v: ProspectFilters[K]) =>
    onChange({ ...value, [key]: v });

  const activeCount =
    (value.ciudad?.length ?? 0) +
    (value.tipo?.length ?? 0) +
    (value.banda?.length ?? 0) +
    (value.status?.length ?? 0) +
    (value.source?.length ?? 0) +
    (value.tieneWeb ? 1 : 0) +
    (value.search ? 1 : 0);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="relative min-w-[220px] flex-1 max-w-xs">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
        <input
          value={value.search ?? ''}
          onChange={(e) => set('search', e.target.value || undefined)}
          placeholder="Buscar por nombre o rubro…"
          className="glass-input w-full rounded-md py-1.5 pl-9 pr-3 text-sm text-ink-primary placeholder:text-ink-muted outline-none"
        />
      </div>

      <MultiSelect label="Ciudad" options={ciudadOptions} value={value.ciudad ?? []} onChange={(v) => set('ciudad', v)} />
      <MultiSelect label="Banda" options={BANDA_OPTIONS} value={value.banda ?? []} onChange={(v) => set('banda', v as ScoreBand[])} />
      <MultiSelect label="Tipo" options={TIPO_OPTIONS} value={value.tipo ?? []} onChange={(v) => set('tipo', v as ProspectType[])} />
      <MultiSelect label="Estado" options={STATUS_OPTIONS} value={value.status ?? []} onChange={(v) => set('status', v as ProspectStatus[])} />
      <MultiSelect label="Web" options={WEB_OPTIONS} value={value.tieneWeb ? [value.tieneWeb] : []} onChange={(v) => set('tieneWeb', (v[v.length - 1] as 'si' | 'no') || undefined)} />
      <MultiSelect label="Fuente" options={sourceOptions} value={value.source ?? []} onChange={(v) => set('source', v)} />

      {activeCount > 0 && (
        <button
          onClick={() => onChange({})}
          className="flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-ink-muted hover:text-ink-primary"
        >
          <X className="h-3.5 w-3.5" /> Limpiar ({activeCount})
        </button>
      )}
    </div>
  );
}
