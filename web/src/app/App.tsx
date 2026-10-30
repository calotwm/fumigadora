import { Route, Routes } from 'react-router';
import { PublicClientPage } from '../features/public/PublicClientPage';
import { LoginPage, RequireAdmin, RequireAuth } from '../features/auth/auth';
import { EmployeeApp } from '../features/employee/EmployeeApp';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { AgendaPage } from '../features/agenda/AgendaPage';
import { CobranzasPage } from '../features/receivables/CobranzasPage';
import { FinanzasPage } from '../features/finance/FinanzasPage';
import { AjustesPage } from '../features/settings/AjustesPage';
import { ClientPage } from '../features/clients/ClientPage';
import { ClientsPage } from '../features/clients/ClientsPage';
import { PageHeader, EmptyState } from '../ui/display';
import { Shell } from './Shell';

function Placeholder({ title, note }: { title: string; note: string }) {
  return (
    <>
      <PageHeader title={title} />
      <EmptyState title={note} />
    </>
  );
}

function NotFound() {
  return <Placeholder title="Página no encontrada" note="La dirección no existe." />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/c/:token" element={<PublicClientPage />} />
      <Route element={<RequireAuth />}>
        <Route path="app" element={<EmployeeApp />} />
      </Route>
      <Route element={<RequireAdmin />}>
        <Route element={<Shell />}>
          <Route index element={<DashboardPage />} />
          <Route path="agenda" element={<AgendaPage />} />
          <Route path="clientes" element={<ClientsPage />} />
          <Route path="clientes/:id" element={<ClientPage />} />
          <Route path="cobranzas" element={<CobranzasPage />} />
          <Route path="finanzas" element={<FinanzasPage />} />
          <Route path="ajustes" element={<AjustesPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  );
}
