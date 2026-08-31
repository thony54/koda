# KODA — Motor de búsqueda de prospectos para Connexo

Capa alta del embudo de Connexo: busca, normaliza, deduplica, califica
(**KODA Score**) y almacena prospectos, y avisa por Discord cuando aparece uno
que vale la pena. Ver el documento técnico completo en
`KODA-documentacion-tecnica.md`.

> **Estado:** Fase 0 (fundaciones). Scaffolding + tokens de Connexo + esquema
> Supabase + login/RLS + layout con rutas vacías. Las pantallas muestran su
> estado vacío y la fase en la que se implementan.

## Stack

React 19 · Vite · TypeScript · Tailwind (tokens de Connexo) · React Router v7 ·
TanStack Query v5 · Zustand · TanStack Table v8 · Recharts · lucide-react ·
Supabase (Postgres + Auth + Edge Functions + pg_cron).

## Requisitos

- Node 20+
- Cuenta de Supabase (para base de datos y auth)

## Puesta en marcha

```bash
npm install
cp .env.example .env.local   # y completa las 2 claves públicas
npm run dev
```

Variables del frontend (solo públicas — nunca la service_role key):

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

## Base de datos

Las migraciones están en `supabase/migrations/`. Ejecutar en orden desde el SQL
Editor de Supabase o con la CLI:

```bash
supabase db push
```

- `0001_schema.sql` — extensiones, enums, tablas, índices, triggers (sección 5).
- `0002_rls.sql` — RLS en todas las tablas con helpers `SECURITY DEFINER`.

Crear el Super Admin a mano (no hay registro público):

1. Authentication → Users → crear usuario con correo/contraseña.
2. El trigger `handle_new_user` crea su fila en `profiles` con rol `lector`.
3. Promover: `update profiles set rol = 'super_admin' where email = '...';`

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo (Vite) |
| `npm run build` | Typecheck + build de producción a `dist/` |
| `npm run preview` | Sirve el build |
| `npm run lint` | `tsc --noEmit` |
| `npm run types` | Regenera `src/types/database.ts` desde Supabase |

## Estructura

```
src/
  lib/         supabase, queryClient, format
  types/       database.ts (generado)
  store/       uiStore (Zustand: tema + toasts)
  hooks/       useAuth
  components/
    ui/        Button, Input, Card, Badge, Modal, Table, Toast, Spinner
    layout/    Sidebar, Topbar, ProtectedRoute, AppLayout, PageHeader
    prospects/ ScoreBadge
  pages/       Login, Dashboard, Prospects, ... , settings/
supabase/
  migrations/  0001_schema.sql, 0002_rls.sql
```

## Notas de diseño

Los tokens (paleta naranja/oscuro de Connexo, fuentes Space Grotesk + Tomorrow,
variables CSS y clases `glass-*`) están copiados de **Connexo Clients**. Lo único
propio de KODA son las 4 bandas de KODA Score (`--score-hot/good/warm/cold`),
derivadas de esa misma paleta. No inventar colores nuevos.
