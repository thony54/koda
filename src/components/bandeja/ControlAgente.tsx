import { useEffect, useRef, useState } from 'react';
import { Bot, FlaskConical, KeyRound, Loader2, Sparkles, TriangleAlert } from 'lucide-react';
import { probarAgente, type ModoAgente, type ResultadoPrueba } from '@/lib/data/agente';
import { PLANTILLA_CONNEXO } from '@/lib/data/connexo';
import { cambiarModo, comprobarClave, refrescarResumen } from '@/lib/bandeja/agenteAcciones';
import { useAgenteStore } from '@/store/agenteStore';
import { useUIStore } from '@/store/uiStore';

const MODOS: { id: ModoAgente; titulo: string; detalle: string }[] = [
  { id: 'apagado', titulo: 'Apagado', detalle: 'No redacta nada.' },
  { id: 'supervisado', titulo: 'Supervisado', detalle: 'Deja un borrador en cada chat; tú lo envías, lo editas o lo descartas. Aprende de lo que haces.' },
  { id: 'automatico', titulo: 'Automático', detalle: 'Responde solo, con una pausa como la de una persona, cuando está seguro. Lo delicado te lo deja a ti.' },
];
const PUNTO: Record<ModoAgente, string> = { apagado: 'bg-ink-muted', supervisado: 'bg-warning', automatico: 'bg-success' };
const ETIQUETA: Record<ModoAgente, string> = { apagado: 'Apagado', supervisado: 'Supervisado', automatico: 'Automático' };
const COMANDO_CLAVE = 'npx supabase secrets set ANTHROPIC_API_KEY=<tu clave>';

export function ControlAgente() {
  const toast = useUIStore((s) => s.toast);
  const config = useAgenteStore((s) => s.config);
  const resumen = useAgenteStore((s) => s.resumen);
  const clave = useAgenteStore((s) => s.clave);
  const [abierto, setAbierto] = useState(false);
  const [confirmarAuto, setConfirmarAuto] = useState(false);
  const [cambiando, setCambiando] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const [theme, setTheme] = useState('default');
  const [probando, setProbando] = useState(false);
  const [prueba, setPrueba] = useState<ResultadoPrueba | null>(null);
  const caja = useRef<HTMLDivElement>(null);

  // Al abrir: se comprueba la clave y se refresca el resumen.
  useEffect(() => { if (abierto) { void comprobarClave(); void refrescarResumen(); } }, [abierto]);
  // Cierra al hacer clic fuera o con Escape.
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => { if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false); };
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(false); };
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', tecla);
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('keydown', tecla); };
  }, [abierto]);

  // Sin la migración 0017 no hay configuración: el control no aparece y la Bandeja funciona como siempre.
  if (!config) return null;

  async function elegir(modo: ModoAgente) {
    if (modo === config?.modo) return;
    if (modo === 'automatico' && !confirmarAuto) { setConfirmarAuto(true); return; }
    setConfirmarAuto(false);
    setCambiando(true);
    const r = await cambiarModo(modo);
    setCambiando(false);
    if (!r.ok) toast(r.error ?? 'No se pudo cambiar el modo.', 'error');
    else toast(modo === 'automatico' ? 'Agente en automático: responderá solo cuando esté seguro.' : modo === 'supervisado' ? 'Agente en modo supervisado.' : 'Agente apagado.', 'success');
  }

  async function probar() {
    if (!mensaje.trim()) return;
    setProbando(true);
    setPrueba(null);
    try { setPrueba(await probarAgente({ mensaje: mensaje.trim(), theme })); }
    catch (e) { setPrueba({ error: e instanceof Error ? e.message : 'No se pudo probar.' }); }
    finally { setProbando(false); }
  }

  const decisiones = resumen ? resumen.aprobados + resumen.editados + resumen.descartados : 0;
  const listo = resumen?.acierto != null && decisiones >= 20 && resumen.acierto >= 80;

  return (
    <div ref={caja} className="relative">
      <button
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="inline-flex h-8 items-center gap-2 rounded-md border border-line px-3 text-xs font-medium text-ink-secondary hover:bg-veil/[0.06] hover:text-ink-primary"
        title="Agente de respuestas"
      >
        <Bot className="h-3.5 w-3.5" />
        <span className={`h-2 w-2 rounded-full ${PUNTO[config.modo]}`} />
        Agente · {ETIQUETA[config.modo]}
      </button>

      {abierto && (
        <div className="absolute right-0 z-50 mt-2 w-[min(92vw,400px)] rounded-lg border border-line-strong bg-surface-raised p-4 shadow-2xl" role="dialog" aria-label="Agente de respuestas">
          <p className="font-heading text-[15px] font-semibold text-ink-primary">Agente de respuestas</p>
          <p className="mt-0.5 text-[12.5px] text-ink-secondary">Redacta la respuesta a cada negocio que escribe: corta, natural y sin emojis.</p>

          {clave === false && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-[12px] text-warning">
              <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div className="min-w-0">
                <p className="font-medium">Falta guardar la clave de Anthropic en Supabase.</p>
                <p className="mt-0.5 break-all font-mono text-[11px] opacity-90">{COMANDO_CLAVE}</p>
                <p className="mt-0.5 opacity-90">Sin ella el agente no puede redactar. Pégala tú en tu terminal, nunca en un chat.</p>
              </div>
            </div>
          )}

          <div className="mt-3 space-y-1.5" role="radiogroup" aria-label="Modo del agente">
            {MODOS.map((m) => {
              const activo = config.modo === m.id;
              return (
                <button
                  key={m.id}
                  role="radio"
                  aria-checked={activo}
                  disabled={cambiando}
                  onClick={() => void elegir(m.id)}
                  className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${activo ? 'border-accent/50 bg-accent/10' : 'border-line hover:bg-veil/[0.05]'} disabled:opacity-60`}
                >
                  <span className="flex items-center gap-2 text-[13px] font-medium text-ink-primary">
                    <span className={`h-2 w-2 rounded-full ${PUNTO[m.id]}`} /> {m.titulo}
                  </span>
                  <span className="mt-0.5 block text-[12px] text-ink-secondary">{m.detalle}</span>
                </button>
              );
            })}
          </div>

          {confirmarAuto && (
            <div className="mt-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-[12.5px] text-ink-primary" role="alertdialog">
              <p className="flex items-center gap-1.5 font-medium text-warning"><TriangleAlert className="h-3.5 w-3.5" /> ¿Pasar a automático?</p>
              <p className="mt-1 text-ink-secondary">
                {resumen?.acierto != null
                  ? `Hoy el agente acierta ${resumen.acierto} % (últimas ${decisiones} decisiones tuyas). `
                  : 'Todavía no tienes decisiones tuyas para medirlo. '}
                En automático envía solo, a nombre de Connexo. Lo delicado (quejas, facturas, contratos, descuentos) te lo sigue dejando a ti, y puedes pausarlo en cualquier chat.
              </p>
              <div className="mt-2 flex gap-2">
                <button onClick={() => void elegir('automatico')} className="glass-button rounded-md px-3 py-1.5 text-[12.5px] font-semibold">Sí, activar automático</button>
                <button onClick={() => setConfirmarAuto(false)} className="rounded-md border border-line px-3 py-1.5 text-[12.5px] text-ink-secondary hover:bg-veil/[0.06]">Mejor no</button>
              </div>
            </div>
          )}

          <div className="mt-3 rounded-md border border-line bg-surface-base/60 p-3 text-[12.5px]">
            <p className="flex items-center gap-1.5 font-medium text-ink-primary"><Sparkles className="h-3.5 w-3.5 text-accent-text" /> Lo que ha aprendido de ti</p>
            {resumen ? (
              <ul className="mt-1.5 space-y-0.5 text-ink-secondary">
                <li><span className="tabular-nums text-ink-primary">{resumen.aprendidos}</span> respuestas tuyas guardadas</li>
                <li>
                  Acierto: <span className="tabular-nums text-ink-primary">{resumen.acierto != null ? `${resumen.acierto} %` : '—'}</span>
                  {decisiones > 0 && <> · {resumen.aprobados} tal cual, {resumen.editados} editados, {resumen.descartados} descartados</>}
                </li>
                {resumen.pendientes > 0 && <li><span className="tabular-nums text-ink-primary">{resumen.pendientes}</span> borradores esperando</li>}
                {resumen.automaticos > 0 && <li><span className="tabular-nums text-ink-primary">{resumen.automaticos}</span> respuestas enviadas por el agente</li>}
              </ul>
            ) : <p className="mt-1.5 text-ink-muted">Cargando…</p>}
            <p className="mt-2 text-[12px] text-ink-muted">
              {listo ? 'Va muy bien: ya puedes probar el modo automático.' : 'Aprende cada vez que envías un borrador, lo corriges o escribes tú. Cuando acierte seguido, podrás pasarlo a automático.'}
            </p>
          </div>

          <div className="mt-3">
            <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink-primary"><FlaskConical className="h-3.5 w-3.5 text-accent-text" /> Probar una respuesta</p>
            <textarea
              value={mensaje}
              onChange={(e) => setMensaje(e.target.value)}
              rows={2}
              placeholder="Lo que escribiría un cliente, p. ej. «¿esto es una página web?»"
              aria-label="Mensaje de prueba"
              className="glass-input mt-1.5 w-full resize-none rounded-md px-3 py-2 text-[13px] text-ink-primary outline-none placeholder:text-ink-muted"
            />
            <div className="mt-1.5 flex items-center gap-2">
              <select value={theme} onChange={(e) => setTheme(e.target.value)} aria-label="Plantilla del negocio de prueba" className="glass-input h-8 min-w-0 flex-1 rounded-md px-2 text-[12.5px] text-ink-primary outline-none">
                {Object.entries(PLANTILLA_CONNEXO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <button onClick={() => void probar()} disabled={probando || !mensaje.trim()} className="glass-button inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-semibold disabled:opacity-60">
                {probando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Probar
              </button>
            </div>
            {prueba && (
              <div className="mt-2 rounded-md border border-line bg-surface-base/70 p-2.5 text-[13px]" role="status">
                {prueba.error ? (
                  <p className="text-danger">{prueba.error}</p>
                ) : prueba.accion === 'responder' ? (
                  <>
                    <p className="whitespace-pre-wrap break-words text-ink-primary">{prueba.texto}</p>
                    <p className="mt-1.5 text-[11.5px] text-ink-muted">
                      {[prueba.intencion, prueba.confianza ? `confianza ${prueba.confianza}` : null, prueba.uso?.salida ? `${prueba.uso.salida} tokens` : null].filter(Boolean).join(' · ')}
                    </p>
                    {prueba.nota && <p className="text-[11.5px] text-ink-muted">{prueba.nota}</p>}
                  </>
                ) : (
                  <p className="text-ink-secondary">{prueba.accion === 'traspasar' ? 'Te lo dejaría a ti' : 'No respondería'}{prueba.nota ? `: ${prueba.nota}` : '.'}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
