import { Navigate, useParams } from 'react-router-dom';

export function V2ProjectPiPage() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={id ? `/projects/${id}/settings` : '/'} replace />;
}
