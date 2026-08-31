import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard,
  Users,
  Search,
  Copy,
  Upload,
  Sparkles,
  Map,
  BarChart3,
  ScrollText,
  Settings,
  SlidersHorizontal,
  Database,
  MessageSquare,
  UserCog,
  ShieldCheck,
} from 'lucide-react';
import type { UserRole } from '@/types/database';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Roles con acceso. Vacío/undefined = todos los usuarios activos. */
  roles?: UserRole[];
  end?: boolean;
}

export interface NavGroup {
  label?: string;
  items: NavItem[];
}

export const navGroups: NavGroup[] = [
  {
    items: [
      { to: '/', label: 'Inicio', icon: LayoutDashboard, end: true },
      { to: '/prospectos', label: 'Prospectos', icon: Users },
      { to: '/busquedas', label: 'Búsquedas', icon: Search },
      { to: '/duplicados', label: 'Duplicados', icon: Copy },
      { to: '/importar', label: 'Importar', icon: Upload },
      { to: '/curaduria', label: 'Curaduría', icon: Sparkles },
      { to: '/mapa', label: 'Mapa', icon: Map },
      { to: '/reportes', label: 'Reportes', icon: BarChart3 },
      { to: '/logs', label: 'Auditoría', icon: ScrollText, roles: ['super_admin'] },
    ],
  },
  {
    label: 'Configuración',
    items: [
      { to: '/configuracion/scoring', label: 'Reglas de scoring', icon: SlidersHorizontal, roles: ['super_admin', 'analista'] },
      { to: '/configuracion/fuentes', label: 'Fuentes', icon: Database, roles: ['super_admin', 'analista'] },
      { to: '/configuracion/discord', label: 'Discord', icon: MessageSquare, roles: ['super_admin'] },
      { to: '/configuracion/usuarios', label: 'Usuarios', icon: UserCog, roles: ['super_admin'] },
      { to: '/configuracion/privacidad', label: 'Privacidad', icon: ShieldCheck, roles: ['super_admin'] },
    ],
  },
];

export const settingsIcon = Settings;
