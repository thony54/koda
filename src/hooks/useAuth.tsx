import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, supabaseConfigured } from '@/lib/supabase';
import type { Profile } from '@/types/database';

interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  /** true mientras se resuelve la sesión inicial o se carga el perfil. */
  loading: boolean;
  /** Usuario con sesión y perfil activo. Base de ProtectedRoute. */
  isAuthorized: boolean;
  /** true cuando NO hay Supabase configurado (falta .env.local). */
  notConfigured: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// Cierre de sesión automático tras 8 h de inactividad (sección 9).
const INACTIVITY_MS = 8 * 60 * 60 * 1000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [profileResolved, setProfileResolved] = useState(false);

  // 1) Sesión: getSession inicial + suscripción. El callback de
  // onAuthStateChange SOLO actualiza el estado de forma síncrona. NO se llama a
  // supabase.from(...) aquí dentro: hacerlo provoca un deadlock (el cliente de
  // auth mantiene un lock) y la app se queda "pegada" sin error.
  useEffect(() => {
    let active = true;

    if (!supabaseConfigured) {
      setInitializing(false);
      setProfileResolved(true);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setInitializing(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // 2) Perfil: se carga reactivamente cuando cambia el usuario de la sesión,
  // FUERA del callback de auth, así no hay deadlock.
  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) {
      setProfile(null);
      setProfileResolved(true);
      return;
    }
    let active = true;
    setProfileResolved(false);
    supabase
      .from('profiles')
      .select('*')
      .eq('id', uid)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) console.warn('[KODA] No se pudo cargar el perfil:', error.message);
        setProfile((data as Profile | null) ?? null);
        setProfileResolved(true);
      });
    return () => {
      active = false;
    };
  }, [session?.user?.id]);

  // 3) Auto-logout por inactividad.
  useEffect(() => {
    if (!session) return;
    let timer: number;
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void supabase.auth.signOut(), INACTIVITY_MS);
    };
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      window.clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [session]);

  async function signIn(email: string, password: string) {
    if (!supabaseConfigured) {
      return {
        error:
          'Supabase no está configurado. Completa VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env.local.',
      };
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }

  async function signOut() {
    await supabase.auth.signOut();
    setProfile(null);
  }

  const loading = initializing || (Boolean(session) && !profileResolved);
  const isAuthorized = Boolean(session && profile?.activo);

  return (
    <AuthContext.Provider
      value={{
        session,
        profile,
        loading,
        isAuthorized,
        notConfigured: !supabaseConfigured,
        signIn,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
