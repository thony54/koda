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
  KeyRound,
} from 'lucide-react';
import type { AccessRule } from '@/lib/permissions';

export interface NavItem extends AccessRule {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

export interface NavGroup {
  label?: string;
  items: NavItem[];
}

/**
 * Menú por usuario. `permiso` = función que el Super Admin habilita en Usuarios;
 * `roles` = pantallas reservadas al administrador. Sin ninguno = todos los activos.
 * Cada ruta se protege igual en App.tsx con <RequireAccess>.
 */
export const navGroups: NavGroup[] = [
  {
    items: [
      { to: '/', label: 'Inicio', icon: LayoutDashboard, end: true },
      { to: '/prospectos', label: 'Prospectos', icon: Users },
      { to: '/busquedas', label: 'Búsquedas', icon: Search, permiso: 'busquedas' },
      { to: '/duplicados', label: 'Duplicados', icon: Copy, permiso: 'duplicados' },
      { to: '/importar', label: 'Importar', icon: Upload, permiso: 'importar' },
      { to: '/curaduria', label: 'Curaduría', icon: Sparkles, permiso: 'curaduria' },
      { to: '/mapa', label: 'Mapa', icon: Map, permiso: 'mapa' },
      { to: '/reportes', label: 'Reportes', icon: BarChart3, permiso: 'reportes' },
      { to: '/logs', label: 'Auditoría', icon: ScrollText, roles: ['super_admin'] },
    ],
  },
  {
    label: 'Configuración',
    items: [
      { to: '/configuracion/integraciones', label: 'Integraciones', icon: KeyRound },
      { to: '/configuracion/discord', label: 'Discord', icon: MessageSquare, permiso: 'discord' },
      { to: '/configuracion/scoring', label: 'Reglas de scoring', icon: SlidersHorizontal, roles: ['super_admin'] },
      { to: '/configuracion/fuentes', label: 'Fuentes', icon: Database, roles: ['super_admin'] },
      { to: '/configuracion/usuarios', label: 'Usuarios', icon: UserCog, roles: ['super_admin'] },
      { to: '/configuracion/privacidad', label: 'Privacidad', icon: ShieldCheck, roles: ['super_admin'] },
    ],
  },
];

export const settingsIcon = Settings;
