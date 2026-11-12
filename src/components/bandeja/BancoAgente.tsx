import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, ChevronDown, Loader2, Pencil, Plus, Search, ShieldCheck, Sparkles, Trash2, UserRound, VolumeX } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Switch } from '@/components/ui/Switch';
import {
  borrarEntradaBanco, guardarEntradaBanco, listBanco, marcarEntradaBanco, puedeIrSola, sembrarBanco,
  type AccionBanco, type EntradaBanco, type GuardarEntrada,
} from '@/lib/data/agente';
import { refrescarResumen } from '@/lib/bandeja/agenteAcciones';
import { useUIStore } from '@/store/uiStore';

// ── Pequeñas utilidades ─────────────────────────────────────────────────────

const sinTildes = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const mensajeDe = (e: unknown, defecto: string): string => (e instanceof Error && e.message ? e.message : defecto);

const ETAPAS: Record<string, string> = {
  borrador: 'demo armada', aprobado: 'demo lista', wa_enviado: 'saludo enviado', aceptado: 'ya aceptó', declinado: 'dijo «más tarde»', vencido: 'invitación vencida',
};
const ACCION: Record<AccionBanco, { etiqueta: string; detalle: string }> = {
  responder: { etiqueta: 'Responde', detalle: 'Redacta un borrador con estas respuestas.' },
  traspasar: { etiqueta: 'Te lo deja a ti', detalle: 'No contesta: te avisa con una nota. Para lo delicado.' },
  omitir: { etiqueta: 'No contesta', detalle: 'Lo deja pasar (por ejemplo, un simple «gracias»).' },
};
const FILTROS = [
  { id: 'todas', etiqueta: 'Todas' },
  { id: 'responde', etiqueta: 'Responde' },
  { id: 'delicadas', etiqueta: 'Te las deja a ti' },
  { id: 'aprendidas', etiqueta: 'Aprendidas' },
  { id: 'tuyas', etiqueta: 'Tuyas' },
  { id: 'apagadas', etiqueta: 'Apagadas' },
] as const;
type Filtro = (typeof FILTROS)[number]['id'];

const pasaFiltro = (e: EntradaBanco, f: Filtro): boolean => {
  switch (f) {
    case 'responde': return e.accion === 'responder' && e.activo;
    case 'delicadas': return e.accion !== 'responder';
    case 'aprendidas': return e.origen === 'aprendida';
    case 'tuyas': return e.origen === 'manual' || e.editada;
    case 'apagadas': return !e.activo;
    default: return true;
  }
};

// ── Formulario ──────────────────────────────────────────────────────────────

interface Form {
  id: string | null;
  titulo: string;
  intencion: string;
  accion: AccionBanco;
  /** Una frase por línea. */
  frases: string;
  /** Una variante por párrafo (separadas por una línea en blanco). */
  respuestas: string;
  cierre: boolean;
  nota: string;
  estados: string[] | null;
  verificada: boolean;
  activo: boolean;
}
const FORM_VACIO: Form = { id: null, titulo: '', intencion: 'otro', accion: 'responder', frases: '', respuestas: '', cierre: true, nota: '', estados: null, verificada: false, activo: true };
const deEntrada = (e: EntradaBanco): Form => ({
  id: e.id, titulo: e.titulo, intencion: e.intencion, accion: e.accion, frases: e.disparadores.join('\n'),
  respuestas: e.respuestas.map((r) => r.t).join('\n\n'), cierre: e.cierre, nota: e.nota ?? '', estados: e.estados, verificada: e.verificada, activo: e.activo,
});
const lineas = (s: string): string[] => s.split('\n').map((x) => x.trim()).filter(Boolean);
const parrafos = (s: string): string[] => s.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);

function validar(f: Form): string | null {
  if (!f.titulo.trim()) return 'Ponle un nombre a la respuesta.';
  const frases = lineas(f.frases);
  if (!frases.length) return 'Escribe al menos una frase con la que te lo preguntarían.';
  if (frases.length > 30) return 'Máximo 30 frases.';
  const resp = parrafos(f.respuestas);
  if (f.accion === 'responder' && !resp.length) return 'Escribe al menos una respuesta.';
  if (resp.length > 12) return 'Máximo 12 variantes.';
  if (resp.some((r) => r.length > 520)) return 'Cada respuesta debe tener 520 caracteres o menos.';
  return null;
}
const aPayload = (f: Form): GuardarEntrada => ({
  id: f.id, titulo: f.titulo.trim(), intencion: f.intencion, accion: f.accion, disparadores: lineas(f.frases),
  respuestas: f.accion === 'responder' ? parrafos(f.respuestas) : [], estados: f.estados, cierre: f.cierre,
  nota: f.nota.trim() || null, verificada: f.verificada, activo: f.activo,
});

const campo = 'glass-input w-full rounded-md px-3 py-2 text-[13px] text-ink-primary outline-none placeholder:text-ink-muted';
const botonSec = 'inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-[12.5px] font-medium text-ink-secondary hover:bg-veil/[0.06] hover:text-ink-primary disabled:opacity-60';

// ── Pantalla ────────────────────────────────────────────────────────────────

/** Las respuestas del agente: ver, buscar, editar, apagar, verificar y escribir las tuyas. Lo que aprende de ti también aparece aquí. */
export function BancoAgente({ abierto, onCerrar }: { abierto: boolean; onCerrar: () => void }) {
  const toast = useUIStore((s) => s.toast);
  const [entradas, setEntradas] = useState<EntradaBanco[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [abiertaId, setAbiertaId] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [confirmarBorrar, setConfirmarBorrar] = useState<string | null>(null);
  const [sembrando, setSembrando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true); setError(null);
    try { setEntradas(await listBanco()); }
    catch (e) { setError(mensajeDe(e, 'No se pudo cargar el banco de respuestas.')); }
    finally { setCargando(false); }
  }, []);
  useEffect(() => { if (abierto) { void cargar(); } else { setForm(null); setConfirmarBorrar(null); } }, [abierto, cargar]);

  const visibles = useMemo(() => {
    const q = sinTildes(busqueda.trim());
    return (entradas ?? []).filter((e) => pasaFiltro(e, filtro) && (!q || sinTildes(`${e.titulo} ${e.disparadores.join(' ')} ${e.respuestas.map((r) => r.t).join(' ')}`).includes(q)));
  }, [entradas, busqueda, filtro]);

  const cambiar = (id: string, parcial: Partial<EntradaBanco>) => setEntradas((l) => (l ?? []).map((e) => (e.id === id ? { ...e, ...parcial } : e)));

  async function marcar(e: EntradaBanco, cambios: { activo?: boolean; verificada?: boolean }) {
    cambiar(e.id, cambios);
    try { await marcarEntradaBanco(e.id, cambios); void refrescarResumen(); }
    catch (err) { cambiar(e.id, { activo: e.activo, verificada: e.verificada }); toast(mensajeDe(err, 'No se pudo guardar el cambio.'), 'error'); }
  }

  async function guardar() {
    if (!form) return;
    const falla = validar(form);
    if (falla) { toast(falla, 'error'); return; }
    setGuardando(true);
    try {
      await guardarEntradaBanco(aPayload(form));
      toast(form.id ? 'Respuesta guardada.' : 'Respuesta creada.', 'success');
      setForm(null);
      await cargar();
      void refrescarResumen();
    } catch (e) { toast(mensajeDe(e, 'No se pudo guardar.'), 'error'); }
    finally { setGuardando(false); }
  }

  async function borrar(e: EntradaBanco) {
    try {
      const r = await borrarEntradaBanco(e.id);
      toast(r === 'desactivada' ? 'Desactivada (las de fábrica no se borran, se pueden volver a activar).' : 'Respuesta borrada.', 'success');
      setConfirmarBorrar(null);
      await cargar();
      void refrescarResumen();
    } catch (err) { toast(mensajeDe(err, 'No se pudo borrar.'), 'error'); }
  }

  async function sembrar() {
    setSembrando(true);
    try { const r = await sembrarBanco(); toast(`Listo: ${r.total ?? 0} respuestas en el banco.`, 'success'); await cargar(); void refrescarResumen(); }
    catch (e) { toast(mensajeDe(e, 'No se pudieron cargar las respuestas de fábrica.'), 'error'); }
    finally { setSembrando(false); }
  }

  const total = entradas?.length ?? 0;

  return (
    <Modal open={abierto} onClose={onCerrar} title="Respuestas del agente" size="lg">
      {form ? (
        <FormularioEntrada form={form} setForm={setForm} guardando={guardando} onGuardar={() => void guardar()} onCancelar={() => setForm(null)} />
      ) : (
        <div className="space-y-3">
          <p className="text-[12.5px] text-ink-secondary">
            Con esto responde el agente cuando el motor es el banco: busca la respuesta que encaja con lo que escribe el cliente, la personaliza y te la deja de borrador.
            Aprende de lo que envías, y las respuestas que apruebes sin cambios pasan a poder ir en automático.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
              <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar una respuesta o una frase" aria-label="Buscar en el banco" className={`${campo} h-9 pl-9`} />
            </div>
            <button onClick={() => setForm({ ...FORM_VACIO })} className="glass-button inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-semibold"><Plus className="h-3.5 w-3.5" /> Nueva respuesta</button>
          </div>

          <div className="flex gap-1 overflow-x-auto pb-0.5" role="tablist" aria-label="Filtrar respuestas">
            {FILTROS.map((f) => (
              <button key={f.id} role="tab" aria-selected={filtro === f.id} onClick={() => setFiltro(f.id)}
                className={`shrink-0 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors ${filtro === f.id ? 'border-accent/40 bg-accent/15 text-accent-text' : 'border-line text-ink-secondary hover:bg-veil/[0.06] hover:text-ink-primary'}`}>
                {f.etiqueta}
              </button>
            ))}
          </div>

          {error && <p className="rounded-md border border-danger/40 bg-danger/10 p-3 text-[12.5px] text-danger">{error}</p>}
          {cargando && !entradas && <div className="grid place-items-center py-12 text-ink-muted"><Loader2 className="h-5 w-5 animate-spin" /></div>}

          {entradas && total === 0 && !cargando && (
            <div className="rounded-lg border border-line bg-surface-base/60 p-5 text-center">
              <BookOpen className="mx-auto h-6 w-6 text-ink-muted" />
              <p className="mt-2 font-heading text-[15px] font-semibold text-ink-primary">El banco está vacío</p>
              <p className="mx-auto mt-1 max-w-sm text-[12.5px] text-ink-secondary">Carga las respuestas de fábrica (precios, «¿es una página web?», la prueba de 7 días…) y desde ahí el agente aprende de ti.</p>
              <button onClick={() => void sembrar()} disabled={sembrando} className="glass-button mt-3 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-60">
                {sembrando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Cargar las respuestas de fábrica
              </button>
            </div>
          )}

          {entradas && total > 0 && (
            <>
              <p className="text-[12px] text-ink-muted" aria-live="polite">
                {visibles.length === total ? `${total} respuestas` : `${visibles.length} de ${total} respuestas`}
                {' · '}
                <button onClick={() => void sembrar()} disabled={sembrando} className="underline decoration-dotted underline-offset-2 hover:text-ink-primary disabled:opacity-60" title="Vuelve a cargar lo de fábrica sin pisar lo que editaste ni lo aprendido">
                  {sembrando ? 'actualizando…' : 'actualizar las de fábrica'}
                </button>
              </p>
              {visibles.length === 0 && <p className="py-8 text-center text-[13px] text-ink-secondary">Nada coincide con esa búsqueda.</p>}
              <ul className="space-y-2">
                {visibles.map((e) => (
                  <Fila key={e.id} e={e} abierta={abiertaId === e.id} onAlternar={() => setAbiertaId(abiertaId === e.id ? null : e.id)}
                    onEditar={() => setForm(deEntrada(e))} onMarcar={(c) => void marcar(e, c)}
                    confirmando={confirmarBorrar === e.id} onPedirBorrar={() => setConfirmarBorrar(e.id)} onCancelarBorrar={() => setConfirmarBorrar(null)} onBorrar={() => void borrar(e)} />
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

// ── Una respuesta del banco ─────────────────────────────────────────────────

function Fila({ e, abierta, onAlternar, onEditar, onMarcar, confirmando, onPedirBorrar, onCancelarBorrar, onBorrar }: {
  e: EntradaBanco; abierta: boolean; onAlternar: () => void; onEditar: () => void; onMarcar: (c: { activo?: boolean; verificada?: boolean }) => void;
  confirmando: boolean; onPedirBorrar: () => void; onCancelarBorrar: () => void; onBorrar: () => void;
}) {
  const sola = puedeIrSola(e);
  const decisiones = e.aprobados + e.editados + e.descartes;
  const primera = e.respuestas[0]?.t;
  const origen = e.origen === 'fabrica' ? 'De fábrica' : e.origen === 'aprendida' ? 'Aprendida de ti' : 'Tuya';
  return (
    <li className={`rounded-lg border bg-surface-base/60 ${e.activo ? 'border-line' : 'border-line/50 opacity-70'}`}>
      <button onClick={onAlternar} aria-expanded={abierta} className="flex w-full items-start gap-3 px-3 py-2.5 text-left">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[13.5px] font-medium text-ink-primary">{e.titulo}</span>
            {e.accion === 'traspasar' && <span className="inline-flex items-center gap-1 rounded-full border border-warning/40 px-2 py-px text-[11px] text-warning"><UserRound className="h-3 w-3" /> Te lo deja a ti</span>}
            {e.accion === 'omitir' && <span className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-px text-[11px] text-ink-muted"><VolumeX className="h-3 w-3" /> No contesta</span>}
            <span className="rounded-full border border-line px-2 py-px text-[11px] text-ink-muted">{origen}</span>
            {!e.activo && <span className="rounded-full border border-line px-2 py-px text-[11px] text-ink-muted">Apagada</span>}
            {e.verificada && <span className="inline-flex items-center gap-1 rounded-full border border-success/40 px-2 py-px text-[11px] text-success"><ShieldCheck className="h-3 w-3" /> Verificada</span>}
            {sola && !e.verificada && <span className="rounded-full border border-success/40 px-2 py-px text-[11px] text-success">Lista para automático</span>}
          </div>
          {primera && <p className="mt-1 line-clamp-2 text-[12.5px] text-ink-secondary">{primera}</p>}
          {!primera && e.nota && <p className="mt-1 line-clamp-2 text-[12.5px] text-ink-secondary">{e.nota}</p>}
          <p className="mt-1 text-[11.5px] text-ink-muted">
            {decisiones > 0
              ? `${e.aprobados} ${e.aprobados === 1 ? 'aprobada' : 'aprobadas'} · ${e.editados} ${e.editados === 1 ? 'corregida' : 'corregidas'} · ${e.descartes} ${e.descartes === 1 ? 'descartada' : 'descartadas'}`
              : e.usos > 0 ? `Usada ${e.usos} ${e.usos === 1 ? 'vez' : 'veces'}` : 'Aún sin usar'}
            {' · '}{e.disparadores.length} {e.disparadores.length === 1 ? 'frase' : 'frases'}{e.respuestas.length > 0 ? ` · ${e.respuestas.length} ${e.respuestas.length === 1 ? 'variante' : 'variantes'}` : ''}
          </p>
        </div>
        <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-ink-muted transition-transform ${abierta ? 'rotate-180' : ''}`} />
      </button>

      {abierta && (
        <div className="space-y-3 border-t border-line/60 px-3 py-3 text-[12.5px]">
          <div>
            <p className="font-medium text-ink-primary">Cómo te lo preguntan</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {e.disparadores.map((d) => <span key={d} className="rounded-md border border-line bg-surface-elevated/60 px-2 py-0.5 text-ink-secondary">{d}</span>)}
            </div>
          </div>
          {e.accion === 'responder' && (
            <div>
              <p className="font-medium text-ink-primary">Cómo responde {e.cierre ? <span className="font-normal text-ink-muted">(y al final le lleva al siguiente paso)</span> : null}</p>
              <ul className="mt-1 space-y-1.5">
                {e.respuestas.map((r) => (
                  <li key={r.t} className="rounded-md border border-line bg-surface-elevated/60 px-2.5 py-1.5 text-ink-primary">
                    {r.t}
                    {r.o !== 'fabrica' && <span className="ml-2 text-[11px] text-accent-text">{r.o === 'aprendida' ? '· aprendida de ti' : '· escrita por ti'}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {e.accion !== 'responder' && e.nota && <div><p className="font-medium text-ink-primary">Lo que te dice</p><p className="mt-1 text-ink-secondary">{e.nota}</p></div>}
          {e.estados && e.estados.length > 0 && <p className="text-ink-muted">Solo cuando el negocio está en: {e.estados.map((s) => ETAPAS[s] ?? s).join(', ')}.</p>}
          {e.accion === 'responder' && !sola && <p className="text-ink-muted">Para ir sola en modo automático: verifícala tú o apruébala 3 veces sin cambios.</p>}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {e.accion === 'responder' && (
              <label className="inline-flex items-center gap-2 text-ink-secondary"><Switch checked={e.verificada} onChange={() => onMarcar({ verificada: !e.verificada })} label="Verificada: puede ir en automático" /> Verificada (puede ir sola)</label>
            )}
            <label className="inline-flex items-center gap-2 text-ink-secondary"><Switch checked={e.activo} onChange={() => onMarcar({ activo: !e.activo })} label="Activa" /> Activa</label>
            <span className="ml-auto flex flex-wrap gap-2">
              <button onClick={onEditar} className={botonSec}><Pencil className="h-3.5 w-3.5" /> Editar</button>
              {confirmando ? (
                <>
                  <button onClick={onBorrar} className="inline-flex items-center gap-1.5 rounded-md border border-danger/50 px-2.5 py-1.5 text-[12.5px] font-medium text-danger hover:bg-danger/10">{e.origen === 'fabrica' ? 'Sí, desactivar' : 'Sí, borrar'}</button>
                  <button onClick={onCancelarBorrar} className={botonSec}>No</button>
                </>
              ) : (
                <button onClick={onPedirBorrar} className={botonSec}><Trash2 className="h-3.5 w-3.5" /> {e.origen === 'fabrica' ? 'Desactivar' : 'Borrar'}</button>
              )}
            </span>
          </div>
        </div>
      )}
    </li>
  );
}

// ── Crear o editar ──────────────────────────────────────────────────────────

function FormularioEntrada({ form, setForm, guardando, onGuardar, onCancelar }: {
  form: Form; setForm: (f: Form) => void; guardando: boolean; onGuardar: () => void; onCancelar: () => void;
}) {
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm({ ...form, [k]: v });
  const responde = form.accion === 'responder';
  // El contenedor del modal conserva el desplazamiento de la lista: el formulario debe verse desde arriba.
  const inicio = useRef<HTMLDivElement>(null);
  useEffect(() => { inicio.current?.scrollIntoView({ block: 'start' }); }, []);
  return (
    <div ref={inicio} className="space-y-4 text-[13px]">
      <p className="font-heading text-[15px] font-semibold text-ink-primary">{form.id ? 'Editar respuesta' : 'Nueva respuesta'}</p>

      <label className="block">
        <span className="text-[12.5px] font-medium text-ink-primary">Nombre</span>
        <input value={form.titulo} onChange={(e) => set('titulo', e.target.value)} maxLength={120} placeholder="p. ej. Horario de atención" className={`${campo} mt-1`} />
      </label>

      <div>
        <span className="text-[12.5px] font-medium text-ink-primary">Qué hace el agente</span>
        <div className="mt-1 grid gap-1.5 sm:grid-cols-3" role="radiogroup" aria-label="Qué hace el agente">
          {(Object.keys(ACCION) as AccionBanco[]).map((a) => (
            <button key={a} role="radio" aria-checked={form.accion === a} onClick={() => set('accion', a)} type="button"
              className={`rounded-md border px-3 py-2 text-left ${form.accion === a ? 'border-accent/50 bg-accent/10' : 'border-line hover:bg-veil/[0.05]'}`}>
              <span className="block text-[13px] font-medium text-ink-primary">{ACCION[a].etiqueta}</span>
              <span className="mt-0.5 block text-[11.5px] text-ink-secondary">{ACCION[a].detalle}</span>
            </button>
          ))}
        </div>
      </div>

      <label className="block">
        <span className="text-[12.5px] font-medium text-ink-primary">Cómo te lo preguntarían <span className="font-normal text-ink-muted">(una frase por línea)</span></span>
        <textarea value={form.frases} onChange={(e) => set('frases', e.target.value)} rows={5} placeholder={'a que hora atienden\nhasta que hora abren\nhorario de atencion'} className={`${campo} mt-1 resize-y`} />
        <span className="mt-1 block text-[11.5px] text-ink-muted">Escríbelas como las diría un cliente. Las tildes y los signos no importan. Mientras más formas pongas, mejor lo reconoce.</span>
      </label>

      {responde ? (
        <label className="block">
          <span className="text-[12.5px] font-medium text-ink-primary">Cómo responde <span className="font-normal text-ink-muted">(varias formas, separadas por una línea en blanco)</span></span>
          <textarea value={form.respuestas} onChange={(e) => set('respuestas', e.target.value)} rows={7} placeholder={'Atendemos de lunes a viernes, de 9 a 18.\n\nRespondemos por aquí en horario de oficina, de lunes a viernes.'} className={`${campo} mt-1 resize-y`} />
          <span className="mt-1 block text-[11.5px] text-ink-muted">
            Corto y natural, sin emojis (el agente los quita). Puedes usar {'{nombre}'}, {'{negocio}'}, {'{beneficio}'} y {'{direccion}'}: se rellenan con los datos de cada negocio, y la frase que no pueda rellenarse se omite.
            Si pones varias formas, el agente las va alternando para no sonar repetido.
          </span>
        </label>
      ) : (
        <label className="block">
          <span className="text-[12.5px] font-medium text-ink-primary">Lo que te dice a ti <span className="font-normal text-ink-muted">(la nota que verás en el chat)</span></span>
          <input value={form.nota} onChange={(e) => set('nota', e.target.value)} maxLength={300} placeholder="Pregunta por el horario: respóndele tú." className={`${campo} mt-1`} />
        </label>
      )}

      {responde && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <label className="inline-flex items-center gap-2 text-ink-secondary"><Switch checked={form.cierre} onChange={() => set('cierre', !form.cierre)} label="Agregar el siguiente paso al final" /> Al final, llevarlo al siguiente paso (tocar el botón, entrar a su perfil…)</label>
          <label className="inline-flex items-center gap-2 text-ink-secondary"><Switch checked={form.verificada} onChange={() => set('verificada', !form.verificada)} label="Verificada" /> Verificada (puede ir en automático)</label>
        </div>
      )}

      <div className="flex justify-end gap-2 border-t border-line pt-3">
        <button onClick={onCancelar} disabled={guardando} className={botonSec}>Cancelar</button>
        <button onClick={onGuardar} disabled={guardando} className="glass-button inline-flex items-center gap-1.5 rounded-md px-4 py-1.5 text-[12.5px] font-semibold disabled:opacity-60">
          {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Guardar
        </button>
      </div>
    </div>
  );
}
