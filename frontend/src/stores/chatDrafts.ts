import { create } from 'zustand';

const MAX_DRAFTS = 200;

interface ChatDraftState {
  drafts: Record<string, string>;
  setDraft: (sessionId: string, value: string) => void;
  clearDraft: (sessionId: string) => void;
  clearAll: () => void;
}

function pruneDrafts(drafts: Record<string, string>): Record<string, string> {
  const ids = Object.keys(drafts);
  if (ids.length <= MAX_DRAFTS) {
    return drafts;
  }

  const next = { ...drafts };
  delete next[ids[0]];
  return next;
}

export const useChatDraftStore = create<ChatDraftState>((set) => ({
  drafts: {},
  setDraft: (sessionId, value) => {
    set((state) => {
      const current = state.drafts[sessionId] ?? '';
      if (current === value) return state;

      if (value.length === 0) {
        if (!(sessionId in state.drafts)) return state;
        const next = { ...state.drafts };
        delete next[sessionId];
        return { drafts: next };
      }

      return { drafts: pruneDrafts({ ...state.drafts, [sessionId]: value }) };
    });
  },
  clearDraft: (sessionId) => {
    set((state) => {
      if (!(sessionId in state.drafts)) return state;
      const next = { ...state.drafts };
      delete next[sessionId];
      return { drafts: next };
    });
  },
  clearAll: () => set({ drafts: {} }),
}));
