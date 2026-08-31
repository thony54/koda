import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { AppLayout } from '@/components/layout/AppLayout';

import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import Prospects from '@/pages/Prospects';
import ProspectDetail from '@/pages/ProspectDetail';
import Jobs from '@/pages/Jobs';
import JobRuns from '@/pages/JobRuns';
import Duplicates from '@/pages/Duplicates';
import Import from '@/pages/Import';
import Curation from '@/pages/Curation';
import MapPage from '@/pages/MapPage';
import Reports from '@/pages/Reports';
import Logs from '@/pages/Logs';
import NotFound from '@/pages/NotFound';
import Scoring from '@/pages/settings/Scoring';
import Sources from '@/pages/settings/Sources';
import Discord from '@/pages/settings/Discord';
import UsersAdmin from '@/pages/settings/UsersAdmin';
import Privacy from '@/pages/settings/Privacy';

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
          <Route index element={<Dashboard />} />
          <Route path="prospectos" element={<Prospects />} />
          <Route path="prospectos/:id" element={<ProspectDetail />} />
          <Route path="busquedas" element={<Jobs />} />
          <Route path="busquedas/:id/runs" element={<JobRuns />} />
          <Route path="duplicados" element={<Duplicates />} />
          <Route path="importar" element={<Import />} />
          <Route path="curaduria" element={<Curation />} />
          <Route path="mapa" element={<MapPage />} />
          <Route path="reportes" element={<Reports />} />
          <Route path="logs" element={<Logs />} />

          <Route path="configuracion/scoring" element={<Scoring />} />
          <Route path="configuracion/fuentes" element={<Sources />} />
          <Route path="configuracion/discord" element={<Discord />} />
          <Route path="configuracion/usuarios" element={<UsersAdmin />} />
          <Route path="configuracion/privacidad" element={<Privacy />} />

          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
