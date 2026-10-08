import { useQueryClient } from '@tanstack/react-query';
import {
  getGetAdminResourcesQueryKey, getGetResourceContextQueryKey, getGetVolunteerResourcesQueryKey, getGetResourceQueryKey,
  getGetOnboardingAgreementsQueryKey, getGetMeQueryKey, getGetVolunteerDashboardQueryKey,
} from '@workspace/api-client-react';

export function useResourceRefresh() {
  const qc = useQueryClient();
  return (id?: string) => Promise.all([
    qc.invalidateQueries({ queryKey: getGetAdminResourcesQueryKey() }),
    qc.invalidateQueries({ queryKey: getGetResourceContextQueryKey() }),
    qc.invalidateQueries({ queryKey: getGetVolunteerResourcesQueryKey() }),
    qc.invalidateQueries({ queryKey: getGetOnboardingAgreementsQueryKey() }),
    qc.invalidateQueries({ queryKey: getGetMeQueryKey() }),
    qc.invalidateQueries({ queryKey: getGetVolunteerDashboardQueryKey() }),
    ...(id ? [qc.invalidateQueries({ queryKey: getGetResourceQueryKey(id) })] : []),
  ]);
}

