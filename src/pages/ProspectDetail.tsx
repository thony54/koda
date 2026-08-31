import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, Phone, Mail, Globe, Instagram, MapPin, ExternalLink,
  CheckCircle2, Ban, Loader2, MessageCircle,
} from 'lucide-react';
import { Card, Badge, Button, Select } from '@/components/ui';
import { ScoreBreakdown } from '@/components/prospects/ScoreBreakdown';
import { TIPO_LABEL, STATUS_LABEL } from '@/components/prospects/Filters';
import { useProspect, useUpdateProspect } from '@/hooks/useProspects';
import { useUIStore } from '@/store/uiStore';
import { formatPhoneEC, formatDateTime, timeAgo } from '@/lib/format';
import type { ProspectStatus } from '@/types/domain';

const VENDEDORES = ['Ana Torres', 'Luis Paredes', 'María Chávez'];

export default function ProspectDetail() {
  const { id } = useParams();
  const { data: p, isLoading } = useProspect(id);
  const update = useUpdateProspect();
  const toast = useUIStore((s) => s.toast);

  if (isLoading) {
    return (
      <div className="grid place-items-center py-20 text-ink-muted">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!p) {
    return (
      <div>
        <Link to="/prospectos" className="mb-3 inline-flex items-center gap-1.5 text-sm text-ink-secondary hover:text-ink-primary">
          <ArrowLeft className="h-4 w-4" /> Prospectos
        </Link>
        <Card><p className="text-ink-secondary">No se encontró el prospecto.</p></Card>
      </div>
    );
  }

  const changeStatus = async (status: ProspectStatus) => {
    await update.mutateAsync({ id: p.id, patch: { status } });
    toast(`Estado → ${STATUS_LABEL[status]}`, 'success');
  };
  const assign = async (vendedor: string) => {
    await update.mutateAsync({ id: p.id, patch: { assigned_to: vendedor || undefined } });
    toast(vendedor ? `Asignado a ${vendedor}` : 'Asignación quitada', 'success');
  };
  const verify = async () => {
    await update.mutateAsync({ id: p.id, patch: { verified_at: new Date().toISOString() } });
    toast('Datos verificados', 'success');
  };
  const noContactar = async () => {
    await update.mutateAsync({ id: p.id, patch: { status: 'no_contactar', opt_out: true } });
    toast('Marcado como no contactar', 'warning');
  };

  return (
    <div>
      <Link to="/prospectos" className="mb-3 inline-flex items-center gap-1.5 text-sm text-ink-secondary hover:text-ink-primary">
        <ArrowLeft className="h-4 w-4" /> Prospectos
      </Link>

      {/* Encabezado */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-ink-primary">{p.nombre}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-secondary">
            <span className="capitalize">{p.categoria}</span>
            <span className="text-ink-muted">·</span>
            <span>{TIPO_LABEL[p.tipo]}</span>
            <span className="text-ink-muted">·</span>
            <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{p.ciudad}, {p.provincia}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="primary">{STATUS_LABEL[p.status]}</Badge>
          {p.plan_sugerido && <Badge>Plan {p.plan_sugerido}</Badge>}
          {p.assigned_to && <Badge variant="info">👤 {p.assigned_to}</Badge>}
          {p.ong_referente && <Badge variant="success">{p.ong_referente}</Badge>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Columna principal */}
        <div className="lg:col-span-2 space-y-5">
          <Card>
            <ScoreBreakdown score={p.score} lines={p.score_desglose} />
          </Card>

          {/* Presencia y actividad */}
          <Card>
            <h2 className="mb-3 font-heading text-lg text-ink-primary">Presencia digital</h2>
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <Stat label="Sitio web" value={p.tiene_website ? 'Sí' : 'No'} accent={!p.tiene_website} />
              <Stat label="Linktree" value={p.usa_linktree ? 'Sí' : 'No'} accent={p.usa_linktree} />
              <Stat label="Reseñas" value={p.reviews_count != null ? String(p.reviews_count) : '—'} />
              <Stat label="Rating" value={p.rating != null ? `${p.rating} ★` : '—'} />
              <Stat label="Instagram" value={p.instagram ? `@${p.instagram}` : '—'} />
              <Stat label="Fuente" value={p.source_nombre ?? '—'} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {p.website && <LinkPill icon={<Globe className="h-3.5 w-3.5" />} href={p.website} label="Web" />}
              {p.instagram && <LinkPill icon={<Instagram className="h-3.5 w-3.5" />} href={`https://instagram.com/${p.instagram}`} label="Instagram" />}
              {p.google_maps_url && <LinkPill icon={<MapPin className="h-3.5 w-3.5" />} href={p.google_maps_url} label="Maps" />}
            </div>
          </Card>

          {/* Notas */}
          <Card>
            <h2 className="mb-3 font-heading text-lg text-ink-primary">Notas</h2>
            {p.notas?.length ? (
              <ul className="space-y-3">
                {p.notas.map((n) => (
                  <li key={n.id} className="rounded-md border border-line bg-surface-elevated p-3">
                    <p className="text-sm text-ink-primary">{n.texto}</p>
                    <p className="mt-1 text-xs text-ink-muted">{n.autor} · {timeAgo(n.created_at)}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-muted">Sin notas. (El editor de notas llega con Supabase conectado.)</p>
            )}
          </Card>
        </div>

        {/* Columna lateral */}
        <div className="space-y-5">
          {/* Acciones */}
          <Card>
            <h2 className="mb-3 font-heading text-lg text-ink-primary">Acciones</h2>
            <div className="space-y-3">
              <Select
                label="Estado"
                value={p.status}
                onChange={(e) => changeStatus(e.target.value as ProspectStatus)}
              >
                {(Object.keys(STATUS_LABEL) as ProspectStatus[]).map((s) => (
                  <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                ))}
              </Select>

              <Select
                label="Asignar vendedor"
                value={p.assigned_to ?? ''}
                onChange={(e) => assign(e.target.value)}
              >
                <option value="">Sin asignar</option>
                {VENDEDORES.map((v) => <option key={v} value={v}>{v}</option>)}
              </Select>

              <div className="grid grid-cols-1 gap-2 pt-1">
                <Button variant="secondary" size="sm" onClick={verify}>
                  <CheckCircle2 className="h-4 w-4" /> Verificar datos
                </Button>
                <Button variant="ghost" size="sm" onClick={noContactar}>
                  <Ban className="h-4 w-4" /> Marcar no contactar
                </Button>
              </div>
              {p.verified_at && (
                <p className="text-xs text-emerald-400">Verificado · {formatDateTime(p.verified_at)}</p>
              )}
            </div>
          </Card>

          {/* Contacto */}
          <Card>
            <h2 className="mb-3 font-heading text-lg text-ink-primary">Contacto</h2>
            {p.contactos?.length ? (
              <ul className="space-y-2">
                {p.contactos.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 text-sm">
                    {c.tipo === 'email' ? <Mail className="h-4 w-4 text-ink-muted" /> : c.tipo === 'whatsapp' ? <MessageCircle className="h-4 w-4 text-ink-muted" /> : <Phone className="h-4 w-4 text-ink-muted" />}
                    <span className="text-ink-primary">
                      {c.tipo === 'email' ? c.valor : formatPhoneEC(c.valor)}
                    </span>
                    {c.etiqueta && <Badge size="sm">{c.etiqueta}</Badge>}
                    {c.verificado && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-muted">Sin contacto directo registrado.</p>
            )}
          </Card>

          {/* Señales */}
          <Card>
            <h2 className="mb-3 font-heading text-lg text-ink-primary">Señales</h2>
            <div className="flex flex-wrap gap-1.5">
              {p.signals?.length ? p.signals.map((s) => (
                <Badge key={s.id} variant={s.peso >= 0 ? 'default' : 'error'} size="sm">
                  {s.clave} {s.peso >= 0 ? `+${s.peso}` : s.peso}
                </Badge>
              )) : <p className="text-sm text-ink-muted">Sin señales.</p>}
            </div>
          </Card>

          {/* Timeline */}
          <Card>
            <h2 className="mb-3 font-heading text-lg text-ink-primary">Actividad</h2>
            <ol className="space-y-3 border-l border-line pl-4">
              {p.actividades?.map((a) => (
                <li key={a.id} className="relative">
                  <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-[var(--primary-orange)]" />
                  <p className="text-sm text-ink-primary">{a.detalle}</p>
                  <p className="text-xs text-ink-muted">{a.autor} · {formatDateTime(a.created_at)}</p>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      {/* Nota trazabilidad */}
      <p className="mt-4 text-xs text-ink-muted">
        Visto por primera vez {timeAgo(p.first_seen_at)} · última vez {timeAgo(p.last_seen_at)}.
        {p.assigned_to ? '' : ' Sin asignar a Connexo Sellers.'}
      </p>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className={`font-medium ${accent ? 'text-[var(--primary-orange)]' : 'text-ink-primary'}`}>{value}</p>
    </div>
  );
}

function LinkPill({ icon, href, label }: { icon: React.ReactNode; href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-xs text-ink-secondary hover:text-ink-primary hover:border-[var(--primary-orange)]/40"
    >
      {icon}{label}<ExternalLink className="h-3 w-3 opacity-60" />
    </a>
  );
}
