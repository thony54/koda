import { create } from 'zustand';
import type { NotificationType } from '@/components/ui';

export type Theme = 'dark' | 'light';

export interface Toast {
  id: string;
  message: string;
  type: NotificationType;
}

interface UIState {
  theme: Theme;
  sidebarOpen: boolean;
  toasts: Toast[];
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toast: (message: string, type?: NotificationType) => void;
  dismissToast: (id: string) => void;
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

const stored = (localStorage.getItem('koda-theme') as Theme | null) ?? 'dark';
applyTheme(stored);

export const useUIStore = create<UIState>((set, get) => ({
  theme: stored,
  sidebarOpen: false,
  toasts: [],

  setTheme: (theme) => {
    applyTheme(theme);
    localStorage.setItem('koda-theme', theme);
    set({ theme });
  },

  toggleTheme: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark';
    get().setTheme(next);
  },

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  toast: (message, type = 'info') => {
    const id = crypto.randomUUID();
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }));
  },

  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
