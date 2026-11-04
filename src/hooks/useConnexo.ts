import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { enviarAConnexo, listEnvios, refrescarEstadosConnexo } from '@/lib/data/connexo';

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
