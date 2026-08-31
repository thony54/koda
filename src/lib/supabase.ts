import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** true si las credenciales reales están presentes. */
export const supabaseConfigured = Boolean(url && anonKey);

if (!supabaseConfigured) {
  // Aviso ruidoso, pero sin tumbar la app: la UI debe renderizar igual para
  // poder trabajar en dev/preview antes de tener el proyecto de Supabase.
  console.warn(
    '[KODA] Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY. ' +
      'Copia .env.example a .env.local y complétalas. ' +
      'El login no funcionará hasta configurarlas.',
  );
}

// Placeholders válidos para que createClient no lance cuando falta el .env.
const FALLBACK_URL = 'https://placeholder.supabase.co';
const FALLBACK_KEY = 'placeholder-anon-key';

/**
 * Cliente del navegador. Usa la ANON KEY + RLS.
 * El navegador NUNCA ve la service_role key (regla de oro, sección 3).
 */
export const supabase = createClient<Database>(
  url || FALLBACK_URL,
  anonKey || FALLBACK_KEY,
  {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

/**
 * Handle sin tipar para la capa de datos. Los `select` con joins embebidos no se
 * infieren bien contra el stub de tipos; mapeamos las filas a dominio a mano.
 * Cuando generes los tipos reales (`npm run types`) puedes quitar el cast.
 */
export const db = supabase as unknown as SupabaseClient;
