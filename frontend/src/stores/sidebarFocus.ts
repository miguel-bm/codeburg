import { create } from 'zustand';

interface SidebarFocusState {
  focused: boolean;
  index: number;
  enter: () => void;
  exit: () => void;
  setIndex: (n: number) => void;
}

export const useSidebarFocusStore = create<SidebarFocusState>((set) => ({
  focused: false,
  index: 0,
  enter: () => set({ focused: true, index: 0 }),
  exit: () => set({ focused: false }),
  setIndex: (n: number) => set({ index: n }),
}));
