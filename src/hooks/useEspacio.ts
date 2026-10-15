import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import {
  getMiEspacio, saveMiEspacio, getMiMemoria, getMiResumen, getVeredicto,
  marcarProspecto, olvidarTodo, recalcularPuntajes, type EspacioInput,
} from '@/lib/data/espacio';

/** El espacio del usuario conectado (null = todavía no lo configuró). */
export function useMiEspacio() {
  const { profile } = useAuth();
  const uid = profile?.id;
  return useQuery({
    queryKey: ['mi-espacio', uid],
    queryFn: () => getMiEspacio(uid!),
    enabled: Boolean(uid),
  });
}

export function useMiMemoria() {
  const { profile } = useAuth();
  const uid = profile?.id;
  return useQuery({
    queryKey: ['mi-memoria', uid],
    queryFn: () => getMiMemoria(uid!),
    enabled: Boolean(uid),
  });
}

export function useMiResumen() {
  const { profile } = useAuth();
  const uid = profile?.id;
  return useQuery({
    queryKey: ['mi-resumen', uid],
    queryFn: () => getMiResumen(uid!),
    enabled: Boolean(uid),
  });
}

/** Tras cambiar el espacio o enseñarle algo a KODA, todo lo que depende del puntaje se refresca. */
function useRefrescar() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['mi-espacio'] });
    qc.invalidateQueries({ queryKey: ['mi-memoria'] });
    qc.invalidateQueries({ queryKey: ['mi-resumen'] });
    qc.invalidateQueries({ queryKey: ['veredicto'] });
    qc.invalidateQueries({ queryKey: ['prospects'] });
    qc.invalidateQueries({ queryKey: ['prospect'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
}

export function useEspacioMutations() {
  const { profile } = useAuth();
  const refrescar = useRefrescar();
  return {
    guardar: useMutation({
      mutationFn: (input: EspacioInput) => saveMiEspacio(profile!.id, input),
      onSuccess: refrescar,
    }),
    olvidar: useMutation({ mutationFn: olvidarTodo, onSuccess: refrescar }),
    recalcular: useMutation({ mutationFn: recalcularPuntajes, onSuccess: refrescar }),
  };
}

/** Lo que el usuario ya le dijo a KODA sobre un prospecto. */
export function useVeredicto(prospectId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['veredicto', prospectId],
    queryFn: () => getVeredicto(prospectId!),
    enabled: Boolean(prospectId) && enabled,
  });
}

export function useMarcarProspecto() {
  const refrescar = useRefrescar();
  return useMutation({
    mutationFn: ({ prospectId, valor }: { prospectId: string; valor: 3 | -3 | 0 }) => marcarProspecto(prospectId, valor),
    onSuccess: refrescar,
  });
}
