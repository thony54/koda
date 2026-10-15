import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, Phone, Mail, Globe, Instagram, MapPin, ExternalLink,
  CheckCircle2, Ban, Loader2, MessageCircle, Brain, ThumbsUp, ThumbsDown,
} from 'lucide-react';
import { Card, Badge, Button, Select } from '@/components/ui';
import { ScoreBreakdown } from '@/components/prospects/ScoreBreakdown';
import { TIPO_LABEL, STATUS_LABEL } from '@/components/prospects/Filters';
import { useProspect, useUpdateProspect } from '@/hooks/useProspects';
import { useAuth } from '@/hooks/useAuth';
import { useAvisoAprendizaje, useMarcarProspecto, useMiEspacio, useVeredicto } from '@/hooks/useEspacio';
import { useUIStore } from '@/store/uiStore';
import { formatPhoneEC, formatDateTime, timeAgo } from '@/lib/format';
import { lineaAprendida, razonesDeEncaje } from '@/lib/aprendizaje';
import { registrarContacto } from '@/lib/data/kodaVivo';
import type { ProspectStatus, ScoreLine } from '@/types/domain';

const VENDEDORES = ['Ana Torres', 'Luis Paredes', 'María Chávez'];

export default function ProspectDetail() {
  const { id } = useParams();
  const { data: p, isLoading } = useProspect(id);
  const update = useUpdateProspect();
  const toast = useUIStore((s) => s.toast);
  const { profile, isOwner } = useAuth();
  const avisar = useAvisoAprendizaje();

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
        <Link to="/prospectos" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-secondary transition-colors hover:text-ink-primary">
          <ArrowLeft className="h-4 w-4" /> Prospectos
        </Link>
        <Card><p className="text-ink-secondary">No se encontró el prospecto.</p></Card>
      </div>
    );
  }

  const changeStatus = async (status: ProspectStatus) => {
    await update.mutateAsync({ id: p.id, patch: { status } });
    toast(`Estado → ${STATUS_LABEL[status]}`, 'success');
    void avisar();
  };
  const assign = async (vendedor: string) => {
    await update.mutateAsync({ id: p.id, patch: { assigned_to: vendedor || undefined } });
    toast(vendedor ? `Asignado a ${vendedor}` : 'Asignación quitada', 'success');
    if (vendedor) void avisar();
  };
  const verify = async () => {
    await update.mutateAsync({ id: p.id, patch: { verified_at: new Date().toISOString() } });
    toast('Datos verificados', 'success');
    void avisar();
  };
  // Abrir un enlace del prospecto es interés real: KODA lo anota (solo con prospectos propios).
  const esMio = Boolean(profile && p.owner_id === profile.id);
  const interes = () => { if (esMio) registrarContacto(p.id); };
  // wa.me pide el número con código de país: lo normal ya viene en E.164; un `09…` local se completa.
  const waDigitos = p.whatsapp ? p.whatsapp.replace(/\D/g, '') : '';
  const wa = waDigitos.startsWith('0') ? `593${waDigitos.slice(1)}` : waDigitos;

  const noContactar = async () => {
    await update.mutateAsync({ id: p.id, patch: { status: 'no_contactar', opt_out: true } });
    toast('Marcado como no contactar', 'warning');
  };

  return (
    <div>
      <Link to="/prospectos" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-secondary transition-colors hover:text-ink-primary">
        <ArrowLeft className="h-4 w-4" /> Prospectos
      </Link>

      {/* Encabezado */}
      <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow mb-2 text-accent-text/80">Ficha de prospecto</p>
          <h1 className="font-heading text-[26px] font-semibold leading-tight text-ink-primary sm:text-[30px]">{p.nombre}</h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-ink-secondary">
            <span className="capitalize">{p.categoria}</span>
            <span className="text-ink-muted">·</span>
            <span>{TIPO_LABEL[p.tipo]}</span>
            <span className="text-ink-muted">·</span>
            <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{p.ciudad}, {p.provincia}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="primary">{STATUS_LABEL[p.status]}</Badge>
          {/* CONECTA / PRO / ULTRA son los planes de Connexo: solo los ve la cuenta propietaria. */}
          {isOwner && p.plan_sugerido && <Badge>Plan {p.plan_sugerido}</Badge>}
          {p.assigned_to && <Badge variant="info">👤 {p.assigned_to}</Badge>}
          {p.ong_referente && <Badge variant="success">{p.ong_referente}</Badge>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Columna principal */}
        <div className="lg:col-span-2 space-y-5">
          <Card ember>
            <PorQueKoda lines={p.score_desglose} />
            <ScoreBreakdown score={p.score} lines={p.score_desglose} />
          </Card>

          {/* Presencia y actividad */}
          <Card>
            <h2 className="mb-3 card-title">Presencia digital</h2>
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <Stat label="Sitio web" value={p.tiene_website ? 'Sí' : 'No'} accent={!p.tiene_website} />
              <Stat label="Linktree" value={p.usa_linktree ? 'Sí' : 'No'} accent={p.usa_linktree} />
              <Stat label="Reseñas" value={p.reviews_count != null ? String(p.reviews_count) : '—'} />
              <Stat label="Rating" value={p.rating != null ? `${p.rating} ★` : '—'} />
              <Stat label="Instagram" value={p.instagram ? `@${p.instagram}` : '—'} />
              <Stat label="Fuente" value={p.source_nombre ?? '—'} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {wa && <LinkPill icon={<MessageCircle className="h-3.5 w-3.5" />} href={`https://wa.me/${wa}`} label="WhatsApp" onOpen={interes} />}
              {p.website && <LinkPill icon={<Globe className="h-3.5 w-3.5" />} href={p.website} label="Web" onOpen={interes} />}
              {p.instagram && <LinkPill icon={<Instagram className="h-3.5 w-3.5" />} href={`https://instagram.com/${p.instagram}`} label="Instagram" onOpen={interes} />}
              {p.google_maps_url && <LinkPill icon={<MapPin className="h-3.5 w-3.5" />} href={p.google_maps_url} label="Maps" onOpen={interes} />}
            </div>
          </Card>

          {/* Notas */}
          <Card>
            <h2 className="mb-3 card-title">Notas</h2>
            {p.notas?.length ? (
              <ul className="space-y-3">
                {p.notas.map((n) => (
                  <li key={n.id} className="rounded-md border border-line bg-surface-inset/60 p-3.5">
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
          {/* Enseñarle a KODA (solo con prospectos propios) */}
          {profile && p.owner_id === profile.id && <EnsenaAKoda prospectId={p.id} />}

          {/* Acciones */}
          <Card>
            <h2 className="mb-3 card-title">Acciones</h2>
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
                <p className="text-xs text-success">Verificado · {formatDateTime(p.verified_at)}</p>
              )}
            </div>
          </Card>

          {/* Contacto */}
          <Card>
            <h2 className="mb-3 card-title">Contacto</h2>
            {p.contactos?.length ? (
              <ul className="space-y-2">
                {p.contactos.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 text-sm">
                    {c.tipo === 'email' ? <Mail className="h-4 w-4 text-ink-muted" /> : c.tipo === 'whatsapp' ? <MessageCircle className="h-4 w-4 text-ink-muted" /> : <Phone className="h-4 w-4 text-ink-muted" />}
                    <span className="text-ink-primary">
                      {c.tipo === 'email' ? c.valor : formatPhoneEC(c.valor)}
                    </span>
                    {c.etiqueta && <Badge size="sm">{c.etiqueta}</Badge>}
                    {c.verificado && <CheckCircle2 className="h-3.5 w-3.5 text-success" />}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-muted">Sin contacto directo registrado.</p>
            )}
          </Card>

          {/* Señales */}
          <Card>
            <h2 className="mb-3 card-title">Señales</h2>
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
            <h2 className="mb-3 card-title">Actividad</h2>
            <ol className="space-y-4 border-l border-line-strong pl-5">
              {p.actividades?.map((a) => (
                <li key={a.id} className="relative">
                  <span className="absolute -left-[25px] top-1.5 h-2 w-2 rounded-full bg-accent shadow-[0_0_8px_rgb(var(--c-accent)/0.8)]" />
                  <p className="text-sm text-ink-primary">{a.detalle}</p>
                  <p className="num mt-0.5 text-[11px] text-ink-muted">{a.autor} · {formatDateTime(a.created_at)}</p>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      {/* Nota trazabilidad */}
      <p className="num mt-6 text-[11px] text-ink-muted">
        Visto por primera vez {timeAgo(p.first_seen_at)} · última vez {timeAgo(p.last_seen_at)}.
        {p.assigned_to ? '' : ' Sin asignar a Connexo Sellers.'}
      </p>
    </div>
  );
}

/** Por qué KODA recomienda este prospecto, dicho como lo diría alguien que te conoce. */
function PorQueKoda({ lines }: { lines: ScoreLine[] }) {
  const razones = razonesDeEncaje(lines);
  const aprendida = lineaAprendida(lines);
  if (!razones.length && !aprendida) return null;
  return (
    <div className="mb-6 rounded-md border border-accent/20 bg-accent/[0.06] px-4 py-3">
      <p className="flex items-center gap-2 text-[13px] font-medium text-accent-text">
        <Brain className="h-4 w-4" /> Por qué te lo muestro así
      </p>
      {razones.length > 0 && (
        <p className="mt-1.5 text-sm text-ink-secondary">
          Suma contigo porque {razones.join(' · ')}.
        </p>
      )}
      {aprendida && (
        <p className={`mt-1 text-sm ${aprendida.puntos > 0 ? 'text-success' : 'text-danger'}`}>
          {aprendida.descripcion} ({aprendida.puntos > 0 ? '+' : ''}{aprendida.puntos})
        </p>
      )}
    </div>
  );
}

/** 👍 / 👎: la forma más directa de decirle a KODA qué tipo de cliente buscas. */
function EnsenaAKoda({ prospectId }: { prospectId: string }) {
  const toast = useUIStore((s) => s.toast);
  const { data: espacio } = useMiEspacio();
  const { data: veredicto } = useVeredicto(prospectId);
  const marcar = useMarcarProspecto();
  const avisar = useAvisoAprendizaje();
  const aprende = espacio?.aprende !== false;
  const actual = veredicto?.explicito ?? null;

  const elegir = async (valor: 3 | -3) => {
    const nuevo = actual === valor ? 0 : valor;       // pulsar de nuevo quita la marca
    try {
      await marcar.mutateAsync({ prospectId, valor: nuevo });
      toast(
        nuevo === 3 ? 'Anotado: este es tu tipo de cliente. KODA lo recuerda.'
          : nuevo === -3 ? 'Anotado: este no es para ti. KODA lo recuerda.'
          : 'Quitaste tu marca.',
        nuevo === -3 ? 'warning' : 'success',
      );
      if (nuevo !== 0) void avisar();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo guardar', 'error');
    }
  };

  return (
    <Card>
      <div className="mb-1 flex items-center gap-2">
        <Brain className="h-4 w-4 text-accent-text" />
        <h2 className="card-title">Enséñale a KODA</h2>
      </div>
      <p className="mb-3 text-xs text-ink-muted">
        ¿Es el tipo de negocio que buscas? KODA lo recuerda para siempre y lo usa para calificar prospectos parecidos.
      </p>
      <div className="grid grid-cols-1 gap-2">
        <Button
          variant={actual === 3 ? 'primary' : 'secondary'}
          size="sm"
          disabled={!aprende || marcar.isPending}
          aria-pressed={actual === 3}
          onClick={() => elegir(3)}
        >
          <ThumbsUp className="h-4 w-4" /> Es mi tipo
        </Button>
        <Button
          variant={actual === -3 ? 'danger' : 'secondary'}
          size="sm"
          disabled={!aprende || marcar.isPending}
          aria-pressed={actual === -3}
          onClick={() => elegir(-3)}
        >
          <ThumbsDown className="h-4 w-4" /> No es para mí
        </Button>
      </div>
      {!aprende && (
        <p className="mt-3 text-xs text-warning">
          Pausaste el aprendizaje. Reactívalo en <Link to="/mi-espacio" className="underline">Mi espacio</Link>.
        </p>
      )}
    </Card>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-md border border-line bg-surface-inset/60 px-3 py-2.5">
      <p className="eyebrow !text-[10px]">{label}</p>
      <p className={`mt-1 truncate font-medium ${accent ? 'text-accent-text' : 'text-ink-primary'}`}>{value}</p>
    </div>
  );
}

function LinkPill({ icon, href, label, onOpen }: { icon: React.ReactNode; href: string; label: string; onOpen?: () => void }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={onOpen}
      className="inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-surface-inset px-2.5 py-1.5 text-xs text-ink-secondary transition-colors hover:border-accent/45 hover:text-ink-primary"
    >
      {icon}{label}<ExternalLink className="h-3 w-3 opacity-60" />
    </a>
  );
}
