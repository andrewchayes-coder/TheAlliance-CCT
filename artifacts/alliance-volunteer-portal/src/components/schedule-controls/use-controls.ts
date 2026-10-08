import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/** Refresh every admin and volunteer cache that reflects schedule state. */
export function useInvalidateSchedule() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({
    predicate: q => {
      const k = q.queryKey[0];
      return typeof k === 'string' && (k.startsWith('/api/admin/') || k.startsWith('/api/volunteer/'));
    },
  });
}
