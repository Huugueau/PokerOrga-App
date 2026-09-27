import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { User } from '@pokerorga/shared';
import { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Loading } from '../components/ui';
import { api, ApiError } from './api';

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return (await api.get<{ user: User }>('/auth/me')).user;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return async () => {
    await api.post('/auth/logout');
    qc.clear();
    window.location.href = '/login';
  };
}

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const loc = useLocation();
  const qc = useQueryClient();
  useEffect(() => {
    const h = () => qc.setQueryData(['me'], null);
    window.addEventListener('po:unauthorized', h);
    return () => window.removeEventListener('po:unauthorized', h);
  }, [qc]);
  if (me.isLoading) return <Loading label="Chargement de votre tournoi" />;
  if (!me.data) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}
