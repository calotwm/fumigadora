import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router';
import { PortalPage } from '../features/portal/PortalPage';
import { PortalVerifyPage } from '../features/portal/PortalVerifyPage';
import { PublicClientPage } from '../features/public/PublicClientPage';
import { LoginPage, RequireAdmin, RequireAuth } from '../features/auth/auth';
import { EmployeeApp } from '../features/employee/EmployeeApp';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { AgendaPage } from '../features/agenda/AgendaPage';
import { CobranzasPage } from '../features/receivables/CobranzasPage';
import { FinanzasPage } from '../features/finance/FinanzasPage';
import { StockPage } from '../features/stock/StockPage';
import { AjustesPage } from '../features/settings/AjustesPage';
import { ClientPage } from '../features/clients/ClientPage';
import { ClientsPage } from '../features/clients/ClientsPage';
import { PageHeader, EmptyState } from '../ui/display';
import { Shell } from './Shell';

// The QR library only loads when someone opens a placard.
const PlacardPage = lazy(() => import('../features/placards/PlacardPages').then((m) => ({ default: m.PlacardPage })));
const PlacardsPage = lazy(() => import('../features/placards/PlacardPages').then((m) => ({ default: m.PlacardsPage })));

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
      <Route path="/portal" element={<PortalPage />} />
      <Route path="/portal/entrar" element={<PortalVerifyPage />} />
      <Route element={<RequireAuth />}>
        <Route path="app" element={<EmployeeApp />} />
      </Route>
      <Route element={<RequireAdmin />}>
        {/* Printable placards live outside the shell: no navigation chrome on paper. */}
        <Route path="carteles" element={<Suspense fallback={<p role="status" className="p-6 text-sm text-muted">Cargando…</p>}><PlacardsPage /></Suspense>} />
        <Route path="clientes/:id/cartel" element={<Suspense fallback={<p role="status" className="p-6 text-sm text-muted">Cargando…</p>}><PlacardPage /></Suspense>} />
        <Route element={<Shell />}>
          <Route index element={<DashboardPage />} />
          <Route path="agenda" element={<AgendaPage />} />
          <Route path="clientes" element={<ClientsPage />} />
          <Route path="clientes/:id" element={<ClientPage />} />
          <Route path="cobranzas" element={<CobranzasPage />} />
          <Route path="finanzas" element={<FinanzasPage />} />
          <Route path="stock" element={<StockPage />} />
          <Route path="ajustes" element={<AjustesPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  );
}
