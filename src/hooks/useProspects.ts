import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  listProspects,
  getProspect,
  updateProspect,
  getFilterFacets,
  type ListParams,
} from '@/lib/data/prospects';
import type { Prospect } from '@/types/domain';

export function useProspects(params: ListParams) {
  return useQuery({
    queryKey: ['prospects', params],
    queryFn: () => listProspects(params),
    placeholderData: keepPreviousData,
  });
}

export function useProspect(id: string | undefined) {
  return useQuery({
    queryKey: ['prospect', id],
    queryFn: () => getProspect(id!),
    enabled: Boolean(id),
  });
}

export function useFilterFacets() {
  return useQuery({
    queryKey: ['prospect-facets'],
    queryFn: getFilterFacets,
    staleTime: 5 * 60_000,
  });
}

export function useUpdateProspect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof updateProspect>[1] }) =>
      updateProspect(id, patch),
    onSuccess: (updated: Prospect | null) => {
      qc.invalidateQueries({ queryKey: ['prospects'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      if (updated) qc.setQueryData(['prospect', updated.id], updated);
    },
  });
}
