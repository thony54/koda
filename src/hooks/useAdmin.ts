import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listScoringRules, upsertScoringRule, updateScoringRule, deleteScoringRule, getSimulationBase,
  listSources, upsertSource, deleteSource,
  listUsers, updateUser,
  listDeletionRequests, listAuditLog, getReportData,
  type ScoringRule, type Source,
} from '@/lib/data/admin';

// ── Scoring ──────────────────────────────────────────────────────────────
export function useScoringRules() {
  return useQuery({ queryKey: ['scoring-rules'], queryFn: listScoringRules });
}
export function useSimulationBase() {
  return useQuery({ queryKey: ['sim-base'], queryFn: getSimulationBase, staleTime: 60_000 });
}
export function useScoringMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['scoring-rules'] });
  return {
    upsert: useMutation({ mutationFn: (r: Partial<ScoringRule> & { clave: string }) => upsertScoringRule(r), onSuccess: invalidate }),
    update: useMutation({ mutationFn: ({ id, patch }: { id: string; patch: Partial<ScoringRule> }) => updateScoringRule(id, patch), onSuccess: invalidate }),
    remove: useMutation({ mutationFn: (id: string) => deleteScoringRule(id), onSuccess: invalidate }),
  };
}

// ── Fuentes ──────────────────────────────────────────────────────────────
export function useSources() {
  return useQuery({ queryKey: ['sources'], queryFn: listSources });
}
export function useSourceMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['sources'] });
    qc.invalidateQueries({ queryKey: ['prospect-facets'] });
  };
  return {
    upsert: useMutation({ mutationFn: (s: Partial<Source>) => upsertSource(s), onSuccess: invalidate }),
    remove: useMutation({ mutationFn: (id: string) => deleteSource(id), onSuccess: invalidate }),
  };
}

// ── Usuarios ─────────────────────────────────────────────────────────────
export function useUsers() {
  return useQuery({ queryKey: ['users'], queryFn: listUsers });
}
export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { rol?: import('@/types/database').UserRole; activo?: boolean } }) =>
      updateUser(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

// ── Privacidad / Auditoría ───────────────────────────────────────────────
export function useDeletionRequests() {
  return useQuery({ queryKey: ['deletion-requests'], queryFn: listDeletionRequests });
}
export function useAuditLog() {
  return useQuery({ queryKey: ['audit-log'], queryFn: () => listAuditLog(100) });
}
export function useReportData() {
  return useQuery({ queryKey: ['report-data'], queryFn: getReportData });
}
