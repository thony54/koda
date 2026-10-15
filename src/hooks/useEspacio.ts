import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useUIStore } from '@/store/uiStore';
import {
  getMiEspacio, saveMiEspacio, getMiMemoria, getMiResumen, getVeredicto,
  marcarProspecto, olvidarTodo, recalcularPuntajes, type EspacioInput,
} from '@/lib/data/espacio';
import { getParaTi, getRecientes, getUltimoAprendizaje } from '@/lib/data/kodaVivo';
import { mensajeAprendizaje } from '@/lib/aprendizaje';

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
    for (const k of [
      'mi-espacio', 'mi-memoria', 'mi-resumen', 'mi-recientes', 'veredicto',
      'prospects', 'prospect', 'dashboard', 'para-ti',
      'koda-pendientes',          // despierta al pulso: recalifica ya
    ]) {
      qc.invalidateQueries({ queryKey: [k] });
    }
  };
}

/** Lo último que KODA tiene en memoria (para "lo último que aprendí"). */
export function useMiRecientes() {
  const { profile } = useAuth();
  const uid = profile?.id;
  return useQuery({
    queryKey: ['mi-recientes', uid],
    queryFn: () => getRecientes(uid!),
    enabled: Boolean(uid),
  });
}

/** Los prospectos que mejor encajan con el usuario y aún no trabajó. */
export function useParaTi(enabled = true) {
  const { profile } = useAuth();
  const uid = profile?.id;
  return useQuery({
    queryKey: ['para-ti', uid],
    queryFn: () => getParaTi(uid!),
    enabled: Boolean(uid) && enabled,
  });
}

/**
 * Devuelve una función que, tras una decisión del usuario, le dice en un aviso qué
 * aprendió KODA. Solo habla si de verdad aprendió algo hace un instante.
 */
export function useAvisoAprendizaje() {
  const toast = useUIStore((s) => s.toast);
  return async () => {
    try {
      const u = await getUltimoAprendizaje();
      const msg = u && u.hace_seg <= 8 ? mensajeAprendizaje(u) : null;
      if (msg) toast(msg, 'info');
    } catch {
      /* el aviso es un extra: nunca debe estorbar */
    }
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
