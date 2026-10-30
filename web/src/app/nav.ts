import { CalendarDays, Gauge, Landmark, Package, Receipt, Users, type LucideIcon } from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Hoy', icon: Gauge, end: true },
  { to: '/agenda', label: 'Agenda', icon: CalendarDays },
  { to: '/clientes', label: 'Clientes', icon: Users },
  { to: '/cobranzas', label: 'Cobranzas', icon: Receipt },
  { to: '/finanzas', label: 'Finanzas', icon: Landmark },
  { to: '/stock', label: 'Stock', icon: Package },
];
