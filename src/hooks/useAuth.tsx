import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, supabaseConfigured } from '@/lib/supabase';
import { queryClient } from '@/lib/queryClient';
import { hasPermission } from '@/lib/permissions';
import { useScopeStore } from '@/store/scopeStore';
import type { PermissionKey, Profile } from '@/types/database';

interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  /** true mientras se resuelve la sesión inicial o se carga el perfil. */
  loading: boolean;
  /** Usuario con sesión y perfil activo. Base de ProtectedRoute. */
  isAuthorized: boolean;
  /** Rol super_admin: todas las funciones, pero solo sobre SU propia base. */
  isSuperAdmin: boolean;
  /** Cuenta propietaria: la única que administra usuarios, ve datos ajenos y edita la configuración global. */
  isOwner: boolean;
  /** ¿Tiene esta función habilitada? (Super Admin: siempre.) Sin clave: solo "activo". */
  can: (permiso?: PermissionKey) => boolean;
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
  // uid cuyo perfil YA terminó de cargarse (con o sin éxito). Comparar contra el
  // usuario de la sesión evita el parpadeo "Cuenta sin acceso" al restaurar la
  // sesión (un render con sesión pero con el perfil todavía sin pedir).
  const [profileUid, setProfileUid] = useState<string | null>(null);

  // 1) Sesión: getSession inicial + suscripción. El callback de
  // onAuthStateChange SOLO actualiza el estado de forma síncrona. NO se llama a
  // supabase.from(...) aquí dentro: hacerlo provoca un deadlock (el cliente de
  // auth mantiene un lock) y la app se queda "pegada" sin error.
  useEffect(() => {
    let active = true;

    if (!supabaseConfigured) {
      setInitializing(false);
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
    // Multiusuario: al cambiar (o perder) la sesión se descarta TODA la caché de
    // datos y el alcance del admin, para no mostrar datos de otra cuenta.
    queryClient.clear();
    useScopeStore.getState().reset();
    if (!uid) {
      setProfile(null);
      setProfileUid(null);
      return;
    }
    let active = true;
    supabase
      .from('profiles')
      .select('*')
      .eq('id', uid)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) console.warn('[KODA] No se pudo cargar el perfil:', error.message);
        const p = (data as Profile | null) ?? null;
        // El alcance se fija ANTES de publicar el perfil: así la primera consulta
        // de cualquier pantalla ya sale filtrada (el admin arranca en "Mis datos").
        if (p) useScopeStore.getState().initFor(p);
        setProfile(p);
        setProfileUid(uid);
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

  const loading = initializing || (Boolean(session) && profileUid !== session?.user?.id);
  const isAuthorized = Boolean(session && profile?.activo);
  const isSuperAdmin = Boolean(profile?.activo && profile.rol === 'super_admin');
  const isOwner = Boolean(profile?.activo && profile.es_propietario);
  const can = (permiso?: PermissionKey) => hasPermission(profile, permiso);

  return (
    <AuthContext.Provider
      value={{
        session,
        profile,
        loading,
        isAuthorized,
        isSuperAdmin,
        isOwner,
        can,
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
