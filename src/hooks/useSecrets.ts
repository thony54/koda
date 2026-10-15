import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getMySecretsStatus, setMySecret, deleteMySecret, type SecretKey } from '@/lib/data/secrets';

/** Qué claves/webhooks propios tiene configurados el usuario (solo últimos 4 caracteres). */
export function useMySecrets() {
  return useQuery({ queryKey: ['my-secrets'], queryFn: getMySecretsStatus, retry: false });
}

export function useSecretMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['my-secrets'] });
    qc.invalidateQueries({ queryKey: ['webhook-status'] });
  };
  return {
    save: useMutation({
      mutationFn: ({ clave, valor }: { clave: SecretKey; valor: string }) => setMySecret(clave, valor),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (clave: SecretKey) => deleteMySecret(clave),
      onSuccess: invalidate,
    }),
  };
}
