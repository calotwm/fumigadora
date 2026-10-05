import { Route, Routes } from 'react-router';
import { LoginPage, RequireAuth } from '../features/auth/auth';
import { DashboardPage } from '../features/dashboard/DashboardPage';
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
      <Route element={<RequireAuth />}>
        <Route element={<Shell />}>
          <Route index element={<DashboardPage />} />
          <Route path="agenda" element={<Placeholder title="Agenda" note="Próximamente: día, semana, mes y próximas visitas." />} />
          <Route path="cobranzas" element={<Placeholder title="Cobranzas" note="Próximamente: antigüedad de deuda, facturas y facturación de abonos." />} />
          <Route path="finanzas" element={<Placeholder title="Finanzas" note="Próximamente: resumen mensual, comparativo y movimientos." />} />
          <Route path="ajustes" element={<Placeholder title="Ajustes" note="Próximamente: tipos de servicio y categorías de gasto." />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  );
}
