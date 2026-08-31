import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

/** Shell autenticado: sidebar fija + topbar + contenido. */
export function AppLayout() {
  return (
    <div className="min-h-screen bg-surface-base">
      <Sidebar />
      <div className="lg:pl-60 flex min-h-screen flex-col">
        <Topbar />
        <main className="flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
