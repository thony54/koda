import { Menu, Moon, Sun, LogOut } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useUIStore } from '@/store/uiStore';

const roleLabel: Record<string, string> = {
  super_admin: 'Super Admin',
  analista: 'Analista',
  lector: 'Lector',
};

export function Topbar() {
  const { profile, signOut } = useAuth();
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const theme = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-surface-base/80 backdrop-blur px-4">
      <button
        onClick={toggleSidebar}
        className="lg:hidden p-1.5 rounded-md text-ink-secondary hover:text-ink-primary hover:bg-white/5"
        aria-label="Abrir menú"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={toggleTheme}
          className="p-2 rounded-md text-ink-secondary hover:text-ink-primary hover:bg-white/5"
          aria-label="Cambiar tema"
          title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>

        <div className="hidden sm:flex flex-col items-end leading-tight mr-1">
          <span className="text-sm font-medium text-ink-primary">
            {profile?.nombre || profile?.email || 'Usuario'}
          </span>
          {profile?.rol && (
            <span className="text-[11px] text-ink-muted">
              {roleLabel[profile.rol] ?? profile.rol}
            </span>
          )}
        </div>

        <button
          onClick={() => void signOut()}
          className="p-2 rounded-md text-ink-secondary hover:text-red-400 hover:bg-white/5"
          aria-label="Cerrar sesión"
          title="Cerrar sesión"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
