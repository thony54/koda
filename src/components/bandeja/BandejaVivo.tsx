import { useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useBandejaStore } from '@/store/bandejaStore';
import { cargarLista, refrescarTodo } from '@/lib/bandeja/acciones';
import { iniciarBandejaEnVivo } from '@/lib/bandeja/vivo';

const SONDEO_SIN_VIVO_MS = 20_000;

/**
 * Mantiene la bandeja viva MIENTRAS la app está abierta (no solo en su pantalla): así el menú muestra los no leídos,
 * la pestaña lleva el contador en el título y suena el aviso aunque estés en otra sección. Solo para el propietario.
 */
export function BandejaVivo() {
  const { isOwner, session } = useAuth();
  const noLeidos = useBandejaStore((s) => s.noLeidos);
  const conexion = useBandejaStore((s) => s.conexion);
  const uid = session?.user?.id;

  useEffect(() => {
    if (!isOwner || !uid) return;
    void cargarLista();                               // la lista aparece aunque Realtime tarde o falle
    return iniciarBandejaEnVivo();
  }, [isOwner, uid]);

  // Red de seguridad: sin conexión en vivo, la bandeja se recarga sola cada 20 s mientras la pestaña esté a la vista.
  useEffect(() => {
    if (!isOwner || conexion === 'en_vivo') return;
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void refrescarTodo(); }, SONDEO_SIN_VIVO_MS);
    return () => window.clearInterval(t);
  }, [isOwner, conexion]);

  // «(3) KODA» en la pestaña.
  useEffect(() => {
    if (!isOwner) return;
    const base = document.title.replace(/^\(\d+\+?\)\s*/, '');
    document.title = noLeidos > 0 ? `(${noLeidos > 99 ? '99+' : noLeidos}) ${base}` : base;
    return () => { document.title = base; };
  }, [isOwner, noLeidos]);

  return null;
}
