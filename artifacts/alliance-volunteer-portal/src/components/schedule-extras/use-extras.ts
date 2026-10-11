import { getGetScheduleExtrasQueryKey, useGetScheduleExtras } from '@workspace/api-client-react';
import { FETCH_CREDS } from '@/auth/auth-context';
import { POLL } from '@/lib/coordinator';

export function useExtras() {
  return useGetScheduleExtras({ query: { queryKey: getGetScheduleExtrasQueryKey(), ...POLL }, request: FETCH_CREDS });
}
