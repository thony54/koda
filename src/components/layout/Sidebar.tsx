import { NavLink } from 'react-router-dom';
import { LogOut, X } from 'lucide-react';
import { navGroups } from './nav';
import { useAuth } from '@/hooks/useAuth';
import { canAccess } from '@/lib/permissions';
import { useUIStore } from '@/store/uiStore';

const roleLabel: Record<string, string> = {
  super_admin: 'Super Admin',
  analista: 'Analista',
  lector: 'Lector',
};

export function Sidebar() {
  const { profile, signOut } = useAuth();
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);

  const displayName = profile?.nombre || profile?.email || 'Usuario';
  const initial = displayName.trim().charAt(0).toUpperCase();

  return (
    <>
      {/* Backdrop móvil */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 animate-fade-in bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-60 shrink-0 flex-col border-r border-line bg-surface-base/95 backdrop-blur transition-transform duration-200 lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Marca */}
        <div className="relative flex h-16 items-center justify-between border-b border-line px-4">
          <div className="flex items-center gap-3">
            <img
              src="/logo.png"
              alt=""
              className="h-9 w-9 select-none object-contain [filter:drop-shadow(0_0_10px_rgb(var(--c-accent)/0.4))]"
              draggable={false}
            />
            <div className="leading-none">
              <p className="font-heading text-[17px] font-semibold tracking-[0.2em] text-ink-primary">
                KODA
              </p>
              <p className="eyebrow mt-1.5 !text-[9px] !tracking-[0.22em]">Connexo</p>
            </div>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="rounded-md p-1.5 text-ink-muted hover:bg-veil/[0.06] hover:text-ink-primary lg:hidden"
            aria-label="Cerrar menú"
          >
            <X className="h-5 w-5" />
          </button>
          {/* Línea de brasa bajo la marca */}
          <span
            aria-hidden
            className="pointer-events-none absolute -bottom-px left-4 h-px w-16 bg-gradient-to-r from-accent to-transparent"
          />
        </div>

        {/* Navegación */}
        <nav className="flex-1 space-y-6 overflow-y-auto px-2 py-5">
          {navGroups.map((group, gi) => {
            const visible = group.items.filter((it) => canAccess(profile, it));
            if (visible.length === 0) return null;
            return (
              <div key={gi} className="space-y-0.5">
                {group.label && (
                  <p className="eyebrow px-3 pb-2 !text-[10px]">{group.label}</p>
                )}
                {visible.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      onClick={() => setSidebarOpen(false)}
                      className="nav-link"
                    >
                      <Icon className="h-[17px] w-[17px]" strokeWidth={1.75} />
                      {item.label}
                    </NavLink>
                  );
                })}
              </div>
            );
          })}
        </nav>

        {/* Usuario */}
        <div className="border-t border-line p-3">
          <div className="flex items-center gap-3 rounded-md p-1.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-accent/30 bg-accent/10 font-heading text-sm font-semibold text-accent-text">
              {initial}
            </span>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-[13px] font-medium text-ink-primary">{displayName}</p>
              {profile?.rol && (
                <p className="eyebrow mt-0.5 !text-[9.5px] !tracking-[0.12em]">
                  {profile.es_propietario ? 'Propietario' : (roleLabel[profile.rol] ?? profile.rol)}
                </p>
              )}
            </div>
            <button
              onClick={() => void signOut()}
              className="rounded-md p-1.5 text-ink-muted transition-colors hover:bg-danger/10 hover:text-danger"
              aria-label="Cerrar sesión"
              title="Cerrar sesión"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
