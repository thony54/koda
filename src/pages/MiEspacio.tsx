import { useEffect, useMemo, useRef, useState } from 'react';
import { Brain, Loader2, RotateCcw, Save, Sparkles, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge, Button, Card, Switch, TagInput, Textarea } from '@/components/ui';
import { TIPO_LABEL } from '@/components/prospects/Filters';
import { useScoringRules } from '@/hooks/useAdmin';
import {
  useEspacioMutations, useMiEspacio, useMiMemoria, useMiResumen,
} from '@/hooks/useEspacio';
import { ESPACIO_VACIO, type EspacioInput } from '@/lib/data/espacio';
import { RUBROS } from '@/lib/rubros';
import { useUIStore } from '@/store/uiStore';
import type { KodaMemoria, KodaPerfil, ProspectType } from '@/types/database';

// Reglas de seguridad: no se muestran ni se pueden reescribir.
const PROTEGIDAS = new Set(['opt_out', 'ya_es_cliente', 'cerrado_permanente']);
// Señales que hoy ningún proceso detecta: ajustarlas no cambiaría nada.
const INACTIVAS = new Set(['web_rota_o_lenta', 'multi_sucursal']);

const GRUPOS_SENALES: { titulo: string; ayuda: string; claves: string[] }[] = [
  {
    titulo: 'Tu nicho',
    ayuda: 'Lo que definiste arriba: rubros, ciudades y palabras.',
    claves: ['rubro_con_plantilla', 'ciudad_objetivo', 'palabra_clave', 'palabra_excluida'],
  },
  {
    titulo: 'Presencia digital',
    ayuda: 'Para vender servicios digitales conviene que NO tengan web; si vendes a negocios ya digitalizados, baja o invierte esta.',
    claves: ['sin_web', 'usa_linktree', 'ig_o_fb_activo', 'whatsapp_publico'],
  },
  {
    titulo: 'Reputación y contacto',
    ayuda: 'Qué tan activo y alcanzable es el negocio.',
    claves: ['resenas_10_plus', 'rating_4_plus', 'contacto_directo', 'sin_ningun_contacto'],
  },
];

/** Texto legible de una característica que KODA recuerda. */
function etiquetaMemoria(feature: string, reglas: Map<string, string>): string {
  const i = feature.indexOf(':');
  const pre = feature.slice(0, i);
  const val = feature.slice(i + 1);
  const bonito = val.replace(/_/g, ' ');
  switch (pre) {
    case 'cat': return `Rubro: ${bonito}`;
    case 'ciudad': return `Ciudad: ${bonito.replace(/\b\w/g, (c) => c.toUpperCase())}`;
    case 'tipo': return `Tipo: ${TIPO_LABEL[val as ProspectType] ?? bonito}`;
    case 'sig': return reglas.get(val) ?? bonito;
    case 'tok': return `Nombre con «${val}»`;
    default: return feature;
  }
}

function sameSpace(a: EspacioInput, b: EspacioInput): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function perfilToInput(p: KodaPerfil | null | undefined): EspacioInput {
  if (!p) return ESPACIO_VACIO;
  return {
    negocio: p.negocio ?? '',
    cliente_ideal: p.cliente_ideal ?? '',
    rubros: p.rubros,
    ciudades: p.ciudades,
    palabras_clave: p.palabras_clave,
    palabras_excluidas: p.palabras_excluidas,
    pesos: p.pesos ?? {},
    aprende: p.aprende,
  };
}

export default function MiEspacio() {
  const toast = useUIStore((s) => s.toast);
  const { data: perfil, isLoading } = useMiEspacio();
  const { data: reglas } = useScoringRules();
  const { data: memoria } = useMiMemoria();
  const { data: resumen } = useMiResumen();
  const { guardar, olvidar, recalcular } = useEspacioMutations();

  const base = useMemo<EspacioInput>(() => perfilToInput(perfil), [perfil]);

  const [draft, setDraft] = useState<EspacioInput>(ESPACIO_VACIO);
  const [busy, setBusy] = useState(false);
  // Cuando cambia lo guardado, el borrador lo adopta SOLO si no tenías ediciones sin guardar;
  // si las tenías, se respetan (solo se sincroniza el interruptor de aprendizaje).
  const baseAnterior = useRef<EspacioInput>(ESPACIO_VACIO);
  useEffect(() => {
    const anterior = baseAnterior.current;          // se captura ANTES: el updater de setDraft corre más tarde
    baseAnterior.current = base;
    setDraft((d) => (sameSpace(d, anterior) ? base : { ...d, aprende: base.aprende }));
  }, [base]);

  const dirty = !sameSpace(draft, base);
  const set = <K extends keyof EspacioInput>(k: K, v: EspacioInput[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const reglaPorClave = useMemo(() => new Map((reglas ?? []).filter((r) => r.activa).map((r) => [r.clave, r])), [reglas]);
  const descPorClave = useMemo(() => new Map([...reglaPorClave].map(([k, r]) => [k, r.descripcion])), [reglaPorClave]);

  const grupos = useMemo(() => {
    const usadas = new Set(GRUPOS_SENALES.flatMap((g) => g.claves));
    const otras = [...reglaPorClave.keys()].filter((k) => !usadas.has(k) && !PROTEGIDAS.has(k) && !INACTIVAS.has(k));
    return [
      ...GRUPOS_SENALES.map((g) => ({ ...g, claves: g.claves.filter((k) => reglaPorClave.has(k)) })),
      ...(otras.length ? [{ titulo: 'Otras señales', ayuda: 'Reglas adicionales de la cuenta.', claves: otras }] : []),
    ].filter((g) => g.claves.length);
  }, [reglaPorClave]);

  function setPeso(clave: string, valor: number, porDefecto: number) {
    const pesos = { ...draft.pesos };
    if (valor === porDefecto) delete pesos[clave]; else pesos[clave] = valor;
    set('pesos', pesos);
  }

  const toggleRubro = (r: string) =>
    set('rubros', draft.rubros.includes(r) ? draft.rubros.filter((x) => x !== r) : [...draft.rubros, r]);

  async function onGuardar() {
    setBusy(true);
    try {
      const guardado = await guardar.mutateAsync(draft);
      setDraft(perfilToInput(guardado));          // lo que la base dejó tras limpiarlo (duplicados, espacios…)
      toast('Espacio guardado. KODA está recalculando tus puntajes…', 'success');
      const r = await recalcular.mutateAsync();
      toast(
        r.pendientes
          ? `${r.calificados} prospectos recalificados; el resto se termina solo en unos minutos.`
          : `${r.calificados} prospectos recalificados con tu espacio.`,
        'success',
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo guardar tu espacio', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onRecalcular() {
    try {
      const r = await recalcular.mutateAsync();
      toast(r.pendientes ? `${r.calificados} recalificados; el resto sigue en segundo plano.` : `${r.calificados} prospectos recalificados.`, 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo recalcular', 'error');
    }
  }

  async function onOlvidar() {
    if (!confirm('¿Borrar todo lo que KODA aprendió de tus decisiones? Tu espacio (rubros, ciudades, palabras) se conserva, pero KODA vuelve a empezar de cero.')) return;
    try {
      await olvidar.mutateAsync();
      toast('KODA olvidó lo aprendido. Recalculando…', 'warning');
      await recalcular.mutateAsync();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo borrar la memoria', 'error');
    }
  }

  async function onToggleAprende() {
    const siguiente = !draft.aprende;
    set('aprende', siguiente);
    // Es un interruptor de comportamiento: se guarda al instante (solo él; tus otras
    // ediciones sin guardar esperan al botón).
    try {
      await guardar.mutateAsync({ ...base, aprende: siguiente });
      toast(siguiente ? 'KODA vuelve a aprender de tus decisiones.' : 'KODA dejó de aprender (conserva lo que ya sabe).', 'success');
    } catch (e) {
      set('aprende', !siguiente);
      toast(e instanceof Error ? e.message : 'No se pudo cambiar', 'error');
    }
  }

  // Lo que KODA aprendió, ordenado por qué tan claro es el "sí" o el "no".
  const aprendido = useMemo(() => {
    const filas = (memoria ?? [])
      .map((m: KodaMemoria) => {
        const n = m.pos + m.neg;
        return { ...m, n, net: n >= 1 ? (m.pos - m.neg) / (n + 2) : 0 };
      })
      .filter((m) => m.n >= 1);
    return {
      si: filas.filter((m) => m.net > 0.15).sort((a, b) => b.net - a.net).slice(0, 7),
      no: filas.filter((m) => m.net < -0.15).sort((a, b) => a.net - b.net).slice(0, 7),
    };
  }, [memoria]);

  if (isLoading) {
    return <div className="grid place-items-center py-24 text-ink-muted"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  const decisiones = resumen?.decisiones ?? 0;

  return (
    <div>
      <PageHeader
        eyebrow="Tu nicho"
        title="Mi espacio"
        description="Cuéntale a KODA qué vendes y a quién buscas. Lo que le enseñes aquí, y lo que decidas sobre cada prospecto, KODA lo recuerda para siempre y lo usa para ordenar tus resultados."
        actions={
          <Button onClick={onGuardar} loading={busy} disabled={!dirty}>
            <Save className="h-4 w-4" /> Guardar y recalcular
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {/* Negocio */}
          <Card>
            <h2 className="card-title">Tu negocio</h2>
            <p className="mb-4 mt-1 text-xs text-ink-muted">
              Con tus palabras. Son tu contexto: lo que realmente ordena tus resultados son los rubros, ciudades y palabras de abajo y lo que KODA aprende de tus decisiones.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Textarea
                label="¿Qué vendes o a qué te dedicas?"
                value={draft.negocio ?? ''}
                maxLength={600}
                onChange={(e) => set('negocio', e.target.value)}
                placeholder="Ej.: Software de reservas para clínicas dentales."
              />
              <Textarea
                label="¿Quién es tu cliente ideal?"
                value={draft.cliente_ideal ?? ''}
                maxLength={600}
                onChange={(e) => set('cliente_ideal', e.target.value)}
                placeholder="Ej.: Consultorios de 2 a 10 personas en Quito que hoy agendan por WhatsApp."
              />
            </div>
          </Card>

          {/* A quién buscas */}
          <Card>
            <h2 className="card-title">A quién buscas</h2>
            <div className="mt-4 space-y-5">
              <div>
                <span className="mb-2 block text-xs font-medium text-ink-secondary">Rubros</span>
                <div className="flex flex-wrap gap-1.5">
                  {RUBROS.map((r) => {
                    const on = draft.rubros.includes(r.value);
                    return (
                      <button
                        key={r.value}
                        type="button"
                        onClick={() => toggleRubro(r.value)}
                        className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                          on ? 'border-accent bg-accent/15 text-accent-text' : 'border-line text-ink-secondary hover:text-ink-primary'
                        }`}
                      >
                        {r.label}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1.5 text-xs text-ink-muted">Los prospectos de estos rubros suman puntos.</p>
              </div>

              <div>
                <TagInput
                  label="Ciudades"
                  value={draft.ciudades}
                  onChange={(v) => set('ciudades', v)}
                  placeholder="Escribe una ciudad y pulsa Enter"
                />
                <p className="mt-1.5 text-xs text-ink-muted">Los prospectos de estas ciudades suman puntos.</p>
              </div>

              <div>
                <TagInput
                  label="Palabras que SÍ quieres ver"
                  value={draft.palabras_clave}
                  onChange={(v) => set('palabras_clave', v)}
                  placeholder="Ej.: dental, odontología, clínica"
                  max={40}
                  minLength={3}
                />
                <p className="mt-1.5 text-xs text-ink-muted">Si el nombre, la categoría o la descripción las menciona, suma puntos.</p>
              </div>

              <div>
                <TagInput
                  label="Palabras que quieres EVITAR"
                  value={draft.palabras_excluidas}
                  onChange={(v) => set('palabras_excluidas', v)}
                  placeholder="Ej.: franquicia, cadena, mayorista"
                  tone="danger"
                  max={40}
                  minLength={3}
                />
                <p className="mt-1.5 text-xs text-ink-muted">Si aparecen, restan puntos fuertes.</p>
              </div>
            </div>
          </Card>

          {/* Importancia de cada señal */}
          <Card>
            <h2 className="card-title">Qué importa para ti</h2>
            <p className="mb-4 mt-1 text-xs text-ink-muted">
              Cada señal suma o resta puntos al KODA Score. Mueve las que no se parezcan a tu nicho; las que no toques siguen la escala general.
              Un valor negativo significa «prefiero que NO lo tenga».
            </p>
            <div className="space-y-6">
              {grupos.map((g) => (
                <div key={g.titulo}>
                  <p className="eyebrow">{g.titulo}</p>
                  <p className="mb-3 mt-1 text-xs text-ink-muted">{g.ayuda}</p>
                  <ul className="space-y-3">
                    {g.claves.map((clave) => {
                      const regla = reglaPorClave.get(clave)!;
                      const propio = draft.pesos[clave];
                      const valor = propio ?? regla.puntos;
                      const ajustado = propio !== undefined;
                      return (
                        <li key={clave} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 sm:grid-cols-[minmax(0,1fr)_160px_auto]">
                          <span className="text-sm text-ink-secondary">
                            {regla.descripcion}
                            {ajustado && <Badge variant="primary" className="ml-2">ajustado</Badge>}
                          </span>
                          <input
                            type="range"
                            min={-50}
                            max={50}
                            step={1}
                            value={valor}
                            aria-label={regla.descripcion}
                            onChange={(e) => setPeso(clave, Number(e.target.value), regla.puntos)}
                            className="order-3 col-span-2 w-full sm:order-none sm:col-span-1"
                            style={{ accentColor: 'rgb(var(--c-accent))' }}
                          />
                          <span className="flex items-center justify-end gap-2">
                            <span className={`num w-9 text-right text-sm font-medium ${valor > 0 ? 'text-success' : valor < 0 ? 'text-danger' : 'text-ink-muted'}`}>
                              {valor > 0 ? `+${valor}` : valor}
                            </span>
                            <button
                              type="button"
                              title={`Volver a la escala general (${regla.puntos > 0 ? '+' : ''}${regla.puntos})`}
                              aria-label="Restablecer"
                              disabled={!ajustado}
                              onClick={() => setPeso(clave, regla.puntos, regla.puntos)}
                              className="p-1 text-ink-muted transition-colors hover:text-ink-primary disabled:opacity-30"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </button>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
              {grupos.length === 0 && <p className="text-sm text-ink-muted">Cargando las reglas…</p>}
            </div>
          </Card>
        </div>

        {/* Memoria de KODA (se queda a la vista mientras recorres el formulario) */}
        <div className="space-y-5 lg:sticky lg:top-6 lg:self-start">
          <Card ember>
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-accent-text" />
              <h2 className="card-title">Lo que KODA aprendió de ti</h2>
            </div>
            <p className="num mt-4 text-[34px] font-semibold leading-none text-ink-primary">
              {decisiones}
              <span className="ml-2 text-sm font-normal text-ink-muted">
                {decisiones === 1 ? 'decisión en memoria' : 'decisiones en memoria'}
              </span>
            </p>
            {decisiones > 0 && (
              <p className="mt-1.5 text-xs text-ink-muted">
                {resumen?.positivas ?? 0} a favor · {resumen?.negativas ?? 0} en contra
              </p>
            )}

            {decisiones < 2 ? (
              <p className="mt-4 text-sm text-ink-secondary">
                Todavía no sé mucho de ti. Cambia el estado de tus prospectos (Interesado, Cliente, Descartado) o
                márcalos con 👍 / 👎 en su ficha, y empiezo a aprender qué te sirve. Con unas 8 decisiones ya te ordeno los resultados a tu manera.
              </p>
            ) : (
              <div className="mt-5 space-y-5">
                <Aprendido titulo="Se parece a lo que aceptas" vacio="Aún no hay un patrón claro." items={aprendido.si} reglas={descPorClave} tono="si" />
                <Aprendido titulo="Se parece a lo que descartas" vacio="Aún no has descartado lo suficiente." items={aprendido.no} reglas={descPorClave} tono="no" />
              </div>
            )}
          </Card>

          <Card>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-medium text-ink-primary">Aprender de mis decisiones</h3>
                <p className="mt-1 text-xs text-ink-muted">
                  Si lo apagas, KODA conserva lo que ya sabe pero deja de sumar y de ajustar tus puntajes con eso.
                </p>
              </div>
              <Switch checked={draft.aprende} onChange={onToggleAprende} label="Aprender de mis decisiones" />
            </div>

            <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
              <Button variant="secondary" size="sm" onClick={onRecalcular} loading={recalcular.isPending}>
                <Sparkles className="h-4 w-4" /> Recalcular puntajes
              </Button>
              <Button variant="danger" size="sm" onClick={onOlvidar} disabled={decisiones === 0 || olvidar.isPending}>
                <Trash2 className="h-4 w-4" /> Borrar lo aprendido
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Aprendido({ titulo, vacio, items, reglas, tono }: {
  titulo: string;
  vacio: string;
  items: (KodaMemoria & { net: number })[];
  reglas: Map<string, string>;
  tono: 'si' | 'no';
}) {
  return (
    <div>
      <p className="eyebrow">{titulo}</p>
      {items.length === 0 ? (
        <p className="mt-2 text-xs text-ink-muted">{vacio}</p>
      ) : (
        <ul className="mt-2.5 space-y-2.5">
          {items.map((m) => (
            <li key={m.feature} title={`${m.pos} a favor · ${m.neg} en contra`}>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate text-ink-secondary">{etiquetaMemoria(m.feature, reglas)}</span>
              </div>
              <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-veil/[0.06]">
                <div
                  className={`h-full rounded-full ${tono === 'si' ? 'bg-success/70' : 'bg-danger/70'}`}
                  style={{ width: `${Math.min(100, Math.abs(m.net) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
