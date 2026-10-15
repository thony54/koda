import { Menu, Moon, Sun } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useUIStore } from '@/store/uiStore';
import { ScopeSwitcher } from './ScopeSwitcher';
import { navGroups } from './nav';

/** Etiqueta de la sección actual a partir del menú (la ruta más específica gana). */
function useSectionLabel(): string {
  const { pathname } = useLocation();
  const items = navGroups.flatMap((g) => g.items);
  const match = items
    .filter((it) => (it.end ? pathname === it.to : pathname === it.to || pathname.startsWith(`${it.to}/`)))
    .sort((a, b) => b.to.length - a.to.length)[0];
  return match?.label ?? '';
}

export function Topbar() {
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const theme = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);
  const section = useSectionLabel();

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-surface-void/70 px-4 backdrop-blur-md sm:px-6 lg:px-8">
      <button
        onClick={toggleSidebar}
        className="-ml-1 rounded-md p-1.5 text-ink-secondary hover:bg-veil/[0.06] hover:text-ink-primary lg:hidden"
        aria-label="Abrir menú"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Ruta de migas: KODA / Sección */}
      <div className="eyebrow flex min-w-0 items-center gap-2 !text-[11px]">
        <span className="hidden sm:inline">KODA</span>
        {section && (
          <>
            <span className="hidden text-accent-text/70 sm:inline">/</span>
            <span className="truncate text-ink-primary">{section}</span>
          </>
        )}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
        <ScopeSwitcher />
        <button
          onClick={toggleTheme}
          className="rounded-md p-2 text-ink-secondary transition-colors hover:bg-veil/[0.06] hover:text-ink-primary"
          aria-label="Cambiar tema"
          title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>
    </header>
  );
}
