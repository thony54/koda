import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { ScopeBanner } from './ScopeSwitcher';

/** Shell autenticado: sidebar fija + topbar + contenido. El fondo atmosférico vive en <body>. */
export function AppLayout() {
  const { pathname } = useLocation();
  return (
    <div className="min-h-screen">
      <Sidebar />
      <div className="flex min-h-screen flex-col lg:pl-60">
        <Topbar />
        <main className="mx-auto w-full max-w-[1480px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <ScopeBanner />
          {/* Fundido suave al cambiar de pantalla */}
          <div key={pathname} className="animate-fade-in">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
