import { api } from './client';
import type { SidebarData } from './types';

export const sidebarApi = {
  get: () => api.get<SidebarData>('/sidebar'),
};
