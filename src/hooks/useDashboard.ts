import { useQuery } from '@tanstack/react-query';
import { getDashboardStats } from '@/lib/data/prospects';

export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: getDashboardStats,
  });
}
