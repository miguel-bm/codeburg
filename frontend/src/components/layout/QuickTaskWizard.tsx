import { Navigate, useSearchParams } from 'react-router-dom';
import { TASK_STATUS } from '../../api';

export function QuickTaskWizard() {
  const [searchParams] = useSearchParams();
  const next = new URLSearchParams(searchParams);
  next.set('status', TASK_STATUS.IN_PROGRESS);

  const query = next.toString();
  return <Navigate to={`/tasks/new${query ? `?${query}` : ''}`} replace />;
}
