import { NavLink } from 'react-router-dom';
import { X } from 'lucide-react';
import { navGroups, type NavItem } from './nav';
import { useAuth } from '@/hooks/useAuth';
import { useUIStore } from '@/store/uiStore';

function canSee(item: NavItem, rol: string | undefined): boolean {
  if (!item.roles || item.roles.length === 0) return true;
  return rol ? item.roles.includes(rol as never) : false;
}

export function Sidebar() {
  const { profile } = useAuth();
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);

  return (
    <>
      {/* Backdrop móvil */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 w-60 shrink-0 border-r border-line bg-surface-base flex flex-col transition-transform duration-200 lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Marca */}
        <div className="flex items-center justify-between px-4 h-14 border-b border-line">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-[var(--primary-orange)] font-heading font-bold text-white">
              K
            </span>
            <div className="leading-tight">
              <p className="font-heading font-semibold text-ink-primary">KODA</p>
              <p className="text-[10px] uppercase tracking-wider text-ink-muted">
                Connexo
              </p>
            </div>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-1 text-ink-muted hover:text-ink-primary"
            aria-label="Cerrar menú"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navegación */}
        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
          {navGroups.map((group, gi) => {
            const visible = group.items.filter((it) => canSee(it, profile?.rol));
            if (visible.length === 0) return null;
            return (
              <div key={gi} className="space-y-0.5">
                {group.label && (
                  <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
                    {group.label}
                  </p>
                )}
                {visible.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      onClick={() => setSidebarOpen(false)}
                      className={({ isActive }) =>
                        `flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                          isActive
                            ? 'bg-[var(--primary-orange)]/12 text-[var(--primary-orange)]'
                            : 'text-ink-secondary hover:text-ink-primary hover:bg-white/5'
                        }`
                      }
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {item.label}
                    </NavLink>
                  );
                })}
              </div>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
