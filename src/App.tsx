import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Outlet } from 'react-router-dom';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { AppLayout } from '@/components/layout/AppLayout';
import { RequireAccess } from '@/components/layout/RequireAccess';
import { Spinner } from '@/components/ui';

// Login va eager (primera pantalla). El resto se carga por demanda (code-split).
import Login from '@/pages/Login';

const Dashboard = lazy(() => import('@/pages/Dashboard'));
const Prospects = lazy(() => import('@/pages/Prospects'));
const ProspectDetail = lazy(() => import('@/pages/ProspectDetail'));
const Jobs = lazy(() => import('@/pages/Jobs'));
const JobRuns = lazy(() => import('@/pages/JobRuns'));
const Duplicates = lazy(() => import('@/pages/Duplicates'));
const Import = lazy(() => import('@/pages/Import'));
const Curation = lazy(() => import('@/pages/Curation'));
const MapPage = lazy(() => import('@/pages/MapPage'));
const Reports = lazy(() => import('@/pages/Reports'));
const Logs = lazy(() => import('@/pages/Logs'));
const NotFound = lazy(() => import('@/pages/NotFound'));
const Scoring = lazy(() => import('@/pages/settings/Scoring'));
const Sources = lazy(() => import('@/pages/settings/Sources'));
const Discord = lazy(() => import('@/pages/settings/Discord'));
const Integrations = lazy(() => import('@/pages/settings/Integrations'));
const UsersAdmin = lazy(() => import('@/pages/settings/UsersAdmin'));
const Privacy = lazy(() => import('@/pages/settings/Privacy'));

function PageFallback() {
  return (
    <div className="grid place-items-center py-20 text-ink-muted">
      <Spinner className="h-6 w-6" />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route
            element={
              <Suspense fallback={<PageFallback />}>
                <Outlet />
              </Suspense>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="prospectos" element={<Prospects />} />
            <Route path="prospectos/:id" element={<ProspectDetail />} />
            <Route path="busquedas" element={<RequireAccess permiso="busquedas"><Jobs /></RequireAccess>} />
            <Route path="busquedas/:id/runs" element={<RequireAccess permiso="busquedas"><JobRuns /></RequireAccess>} />
            <Route path="duplicados" element={<RequireAccess permiso="duplicados"><Duplicates /></RequireAccess>} />
            <Route path="importar" element={<RequireAccess permiso="importar"><Import /></RequireAccess>} />
            <Route path="curaduria" element={<RequireAccess permiso="curaduria"><Curation /></RequireAccess>} />
            <Route path="mapa" element={<RequireAccess permiso="mapa"><MapPage /></RequireAccess>} />
            <Route path="reportes" element={<RequireAccess permiso="reportes"><Reports /></RequireAccess>} />
            <Route path="logs" element={<RequireAccess propietario><Logs /></RequireAccess>} />

            <Route path="configuracion/integraciones" element={<Integrations />} />
            <Route path="configuracion/discord" element={<RequireAccess permiso="discord"><Discord /></RequireAccess>} />
            <Route path="configuracion/scoring" element={<RequireAccess propietario><Scoring /></RequireAccess>} />
            <Route path="configuracion/fuentes" element={<RequireAccess propietario><Sources /></RequireAccess>} />
            <Route path="configuracion/usuarios" element={<RequireAccess propietario><UsersAdmin /></RequireAccess>} />
            <Route path="configuracion/privacidad" element={<RequireAccess propietario><Privacy /></RequireAccess>} />

            <Route path="*" element={<NotFound />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
