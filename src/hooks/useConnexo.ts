import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  cupoWhatsApp, detalleEnvio, enviarAConnexo, enviarWhatsApp, listEnvios, refrescarEstadosConnexo, revisarEnvios,
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

export function useEnviarAConnexo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => enviarAConnexo(ids),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['connexo-envios'] }),
  });
}

export function useRefrescarConnexo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: refrescarEstadosConnexo,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['connexo-envios'] });
      if (r.actualizados) refrescarAprendizaje(qc);
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
    },
  });
}
