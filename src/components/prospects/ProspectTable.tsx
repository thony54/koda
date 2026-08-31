import { useNavigate } from 'react-router-dom';
import { ArrowUp, ArrowDown, Phone, Mail, Globe, Instagram, MapPin } from 'lucide-react';
import { Table, THead, TBody, TR, TH, TD, Badge } from '@/components/ui';
import { ScoreBadge } from './ScoreBadge';
import { TIPO_LABEL, STATUS_LABEL } from './Filters';
import type { Prospect } from '@/types/domain';
import type { SortField, SortDir } from '@/lib/data/prospects';
import { timeAgo } from '@/lib/format';

const statusVariant: Record<string, 'default' | 'success' | 'warning' | 'info' | 'primary' | 'error'> = {
  nuevo: 'info',
  calificado: 'primary',
  en_contacto: 'warning',
  interesado: 'warning',
  negociacion: 'warning',
  cliente: 'success',
  descartado: 'default',
  no_contactar: 'error',
};

interface Props {
  rows: Prospect[];
  sortBy: SortField;
  sortDir: SortDir;
  onSort: (field: SortField) => void;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  loading?: boolean;
}

function SortHeader({
  field, label, active, dir, onSort, align = 'left',
}: {
  field: SortField; label: string; active: boolean; dir: SortDir;
  onSort: (f: SortField) => void; align?: 'left' | 'right';
}) {
  return (
    <TH className={align === 'right' ? 'text-right' : ''}>
      <button
        onClick={() => onSort(field)}
        className={`inline-flex items-center gap-1 hover:text-ink-primary ${active ? 'text-[var(--primary-orange)]' : ''}`}
      >
        {label}
        {active && (dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </button>
    </TH>
  );
}

export function ProspectTable({
  rows, sortBy, sortDir, onSort, selected, onToggle, onToggleAll, loading,
}: Props) {
  const navigate = useNavigate();
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  return (
    <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
      <Table>
        <THead>
          <TR className="hover:bg-transparent">
            <TH className="w-10">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={onToggleAll}
                aria-label="Seleccionar todos"
                className="accent-[var(--primary-orange)]"
              />
            </TH>
            <SortHeader field="nombre" label="Prospecto" active={sortBy === 'nombre'} dir={sortDir} onSort={onSort} />
            <SortHeader field="ciudad" label="Ciudad" active={sortBy === 'ciudad'} dir={sortDir} onSort={onSort} />
            <TH>Tipo</TH>
            <SortHeader field="score" label="Score" active={sortBy === 'score'} dir={sortDir} onSort={onSort} />
            <TH>Plan</TH>
            <TH>Estado</TH>
            <TH>Contacto</TH>
            <SortHeader field="last_seen_at" label="Última vez" active={sortBy === 'last_seen_at'} dir={sortDir} onSort={onSort} />
          </TR>
        </THead>
        <TBody>
          {rows.map((p) => (
            <TR
              key={p.id}
              className="cursor-pointer"
              onClick={() => navigate(`/prospectos/${p.id}`)}
            >
              <TD onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={selected.has(p.id)}
                  onChange={() => onToggle(p.id)}
                  aria-label={`Seleccionar ${p.nombre}`}
                  className="accent-[var(--primary-orange)]"
                />
              </TD>
              <TD>
                <div className="font-medium text-ink-primary">{p.nombre}</div>
                <div className="text-xs text-ink-muted capitalize">{p.categoria}</div>
              </TD>
              <TD>
                <span className="inline-flex items-center gap-1 text-ink-secondary">
                  <MapPin className="h-3 w-3 text-ink-muted" />
                  {p.ciudad}
                </span>
              </TD>
              <TD className="text-ink-secondary">{TIPO_LABEL[p.tipo]}</TD>
              <TD><ScoreBadge score={p.score} /></TD>
              <TD>
                {p.plan_sugerido && (
                  <span className="text-xs font-semibold text-ink-secondary">{p.plan_sugerido}</span>
                )}
              </TD>
              <TD>
                <Badge variant={statusVariant[p.status] ?? 'default'}>
                  {STATUS_LABEL[p.status]}
                </Badge>
              </TD>
              <TD>
                <div className="flex items-center gap-1.5 text-ink-muted">
                  {(p.whatsapp || p.contactos?.some((c) => c.tipo === 'telefono')) && <Phone className="h-3.5 w-3.5" />}
                  {p.contactos?.some((c) => c.tipo === 'email') && <Mail className="h-3.5 w-3.5" />}
                  {p.tiene_website && <Globe className="h-3.5 w-3.5" />}
                  {p.instagram && <Instagram className="h-3.5 w-3.5" />}
                </div>
              </TD>
              <TD className="text-xs text-ink-muted whitespace-nowrap">{timeAgo(p.last_seen_at)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
