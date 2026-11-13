import { useQuery } from '@tanstack/react-query';
import { getGastoMes } from '@/lib/data/gasto';
import { useAuth } from '@/hooks/useAuth';
import { useScopeStore } from '@/store/scopeStore';

/**
 * Gasto del mes en vivo: se vuelve a calcular cada 30 s y al volver a la pestaña.
 * WhatsApp solo se cuenta para el propietario viendo su propia cuenta (los saludos salen por su número).
 */
export function useGastoMes() {
  const { profile, isOwner } = useAuth();
  const scopeOwner = useScopeStore((s) => s.ownerId);
  const conWhatsapp = isOwner && (!scopeOwner || scopeOwner === profile?.id);
  return useQuery({
    queryKey: ['gasto-mes', scopeOwner ?? 'yo', conWhatsapp],
    queryFn: () => getGastoMes({ whatsapp: conWhatsapp }),
    enabled: Boolean(profile?.id),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}
