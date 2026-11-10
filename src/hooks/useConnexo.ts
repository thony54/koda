import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  cupoWhatsApp, detalleEnvio, enviarAConnexo, enviarWhatsApp, listEnvios, listLotes, refrescarEstadosConnexo,
  renombrarLote, revisarEnvios, vistaPreviaEnvio,
  type PasoRevision,
} from '@/lib/data/connexo';

/**
 * Cada cambio de estado de un envío le enseña algo a KODA (migración 0014): se refresca lo que
 * depende de la memoria y se despierta al pulso para que recalifique al instante.
 */
function refrescarAprendizaje(qc: ReturnType<typeof useQueryClient>) {
  for (const k of ['mi-memoria', 'mi-resumen', 'mi-recientes', 'veredicto', 'para-ti', 'dashboard', 'koda-pendientes']) {
    qc.invalidateQueries({ queryKey: [k] });
  }
}

export function useEnvios(enabled = true) {
  return useQuery({ queryKey: ['connexo-envios'], queryFn: listEnvios, enabled });
}

export function useLotes(enabled = true) {
  return useQuery({ queryKey: ['connexo-lotes'], queryFn: listLotes, enabled });
}

/** Qué saldría en el lote y por qué se omite el resto. Se pide al abrir el armado del lote; no envía nada. */
export function useVistaPreviaLote(ids: string[], enabled: boolean) {
  return useQuery({
    queryKey: ['connexo-vista-previa', ids],
    queryFn: () => vistaPreviaEnvio(ids),
    enabled: enabled && ids.length > 0,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

export function useRenombrarLote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, nombre }: { id: string; nombre: string }) => renombrarLote(id, nombre),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['connexo-lotes'] }),
  });
}

/** Cambia lo que la lista de Prospectos considera «ya en Connexo» (espejo en la base), por eso también la refresca. */
function refrescarListaProspectos(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['prospects'] });
  qc.invalidateQueries({ queryKey: ['prospectos-en-connexo'] });
}

export function useEnviarAConnexo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, nombre, onProgreso }: { ids: string[]; nombre?: string; onProgreso?: (hechos: number, total: number) => void }) =>
      enviarAConnexo(ids, nombre, onProgreso),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['connexo-envios'] });
      qc.invalidateQueries({ queryKey: ['connexo-lotes'] });
      refrescarListaProspectos(qc);
    },
  });
}

export function useRefrescarConnexo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: refrescarEstadosConnexo,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['connexo-envios'] });
      if (r.actualizados) {
        refrescarAprendizaje(qc);
        refrescarListaProspectos(qc);
      }
    },
  });
}

/** Qué se llenó en el borrador y de dónde salió cada dato; se pide a Connexo al abrir la revisión. */
export function useDetalleEnvio(envioId: string | null) {
  return useQuery({
    queryKey: ['connexo-detalle', envioId],
    queryFn: () => detalleEnvio(envioId as string),
    enabled: !!envioId,
    staleTime: 15_000,
  });
}

/** Cupo de WhatsApp del día. Si Connexo no responde simplemente no se muestra (sin reintentos ni errores). */
export function useCupoWhatsApp(enabled = true) {
  return useQuery({ queryKey: ['connexo-wa-cupo'], queryFn: cupoWhatsApp, enabled, retry: false, staleTime: 30_000 });
}

export function useEnviarWhatsApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => enviarWhatsApp(ids),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['connexo-envios'] });
      qc.invalidateQueries({ queryKey: ['connexo-wa-cupo'] });
      refrescarAprendizaje(qc);
      refrescarListaProspectos(qc);
    },
  });
}

export function useRevisarEnvios() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, paso }: { ids: string[]; paso: PasoRevision }) => revisarEnvios(ids, paso),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['connexo-envios'] });
      qc.invalidateQueries({ queryKey: ['connexo-detalle'] });
      refrescarAprendizaje(qc);
      refrescarListaProspectos(qc);
    },
  });
}
