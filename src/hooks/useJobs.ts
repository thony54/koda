import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listJobs, upsertJob, deleteJob, listJobRuns, type JobInput } from '@/lib/data/jobs';

export function useJobs() {
  return useQuery({
    queryKey: ['jobs'],
    queryFn: listJobs,
    // Mientras alguna búsqueda esté corriendo (cron u otra pestaña) se refresca sola.
    refetchInterval: (q) => (q.state.data?.some((j) => j.ultimo?.status === 'corriendo') ? 4000 : false),
  });
}

export function useJobMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['jobs'] });
  return {
    upsert: useMutation({ mutationFn: (j: JobInput & { id?: string }) => upsertJob(j), onSuccess: invalidate }),
    remove: useMutation({ mutationFn: (id: string) => deleteJob(id), onSuccess: invalidate }),
  };
}

export function useJobRuns(jobId: string | undefined) {
  return useQuery({
    queryKey: ['job-runs', jobId],
    queryFn: () => listJobRuns(jobId!),
    enabled: Boolean(jobId),
  });
}
