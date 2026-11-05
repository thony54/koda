import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  detalleEnvio, enviarAConnexo, listEnvios, refrescarEstadosConnexo, revisarEnvios, type PasoRevision,
} from '@/lib/data/connexo';

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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['connexo-envios'] }),
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

export function useRevisarEnvios() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, paso }: { ids: string[]; paso: PasoRevision }) => revisarEnvios(ids, paso),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['connexo-envios'] });
      qc.invalidateQueries({ queryKey: ['connexo-detalle'] });
    },
  });
}
