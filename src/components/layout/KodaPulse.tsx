import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { getPendientesMios } from '@/lib/data/kodaVivo';
import { recalcularPuntajes } from '@/lib/data/espacio';

const MIN_ENTRE_CORRIDAS_MS = 4000;
const MAX_INTENTOS_SIN_AVANCE = 3;

/**
 * El pulso de KODA. Cada vez que el usuario decide algo (estado, 👍/👎, asignar, abrir un
 * enlace…) la base anota que sus prospectos esperan recalificarse; este componente lo ve
 * en segundos y llama al scorer al instante, así los puntajes reflejan lo último que
 * KODA aprendió sin esperar al cron. Mientras trabaja muestra un indicador en la barra.
 *
 * Es defensivo: no insiste si 3 corridas seguidas no logran avanzar (el cron sigue de respaldo).
 */
export function KodaPulse() {
  const qc = useQueryClient();
  const { isAuthorized } = useAuth();
  const [trabajando, setTrabajando] = useState(false);
  const [alDia, setAlDia] = useState(false);
  const ultimaCorrida = useRef(0);
  const atasco = useRef({ ultimo: 0, intentos: 0 });

  const { data: pendientes = 0 } = useQuery({
    queryKey: ['koda-pendientes'],
    queryFn: getPendientesMios,
    enabled: isAuthorized,
    retry: false,
    refetchIntervalInBackground: false,
    // Rápido mientras hay trabajo; tranquilo cuando no (por si el cron o una importación dejan pendientes).
    refetchInterval: (q) => ((q.state.data ?? 0) > 0 ? 3000 : 30_000),
  });

  useEffect(() => {
    if (!isAuthorized || trabajando || pendientes <= 0) return;
    if (pendientes > atasco.current.ultimo) atasco.current.intentos = 0;          // hay novedades: reintentar
    if (atasco.current.intentos >= MAX_INTENTOS_SIN_AVANCE) return;

    const espera = Math.max(600, MIN_ENTRE_CORRIDAS_MS - (Date.now() - ultimaCorrida.current));
    const timer = window.setTimeout(async () => {
      setTrabajando(true);
      const antes = pendientes;
      try {
        const r = await recalcularPuntajes();
        const despues = await getPendientesMios();
        atasco.current = { ultimo: despues, intentos: despues >= antes ? atasco.current.intentos + 1 : 0 };
        qc.setQueryData(['koda-pendientes'], despues);
        if (r.calificados > 0) {
          for (const k of ['prospects', 'prospect', 'dashboard', 'para-ti', 'mi-memoria', 'mi-resumen', 'mi-recientes']) {
            qc.invalidateQueries({ queryKey: [k] });
          }
        }
        if (despues === 0) {
          setAlDia(true);
          window.setTimeout(() => setAlDia(false), 2500);
        }
      } catch {
        atasco.current = { ultimo: pendientes, intentos: atasco.current.intentos + 1 };
      } finally {
        ultimaCorrida.current = Date.now();
        setTrabajando(false);
      }
    }, espera);
    return () => window.clearTimeout(timer);
  }, [isAuthorized, trabajando, pendientes, qc]);

  if (!isAuthorized) return null;

  if (trabajando || (pendientes > 0 && atasco.current.intentos < MAX_INTENTOS_SIN_AVANCE)) {
    return (
      <span
        className="hidden h-8 items-center rounded-md border border-accent/40 bg-accent/10 px-3 text-xs font-medium text-accent-text sm:inline-flex"
        role="status"
        title="KODA está aplicando lo que aprendió a tus prospectos"
      >
        <span className="pulse-dot" />
        KODA actualizando tus puntajes…
      </span>
    );
  }
  if (alDia) {
    return (
      <span
        className="hidden h-8 items-center gap-1.5 rounded-md border border-success/30 bg-success/10 px-3 text-xs font-medium text-success sm:inline-flex"
        role="status"
      >
        <Check className="h-3.5 w-3.5" /> KODA al día
      </span>
    );
  }
  return null;
}
