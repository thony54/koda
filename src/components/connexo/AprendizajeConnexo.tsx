import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Brain } from 'lucide-react';
import { Card } from '@/components/ui';
import { ESTADOS_INVITADOS, respuestasPor, type ConnexoEnvio, type FilaRespuesta } from '@/lib/data/connexo';
import { RUBRO_LABEL } from '@/lib/rubros';

const pct = (f: FilaRespuesta) => `${Math.round((f.aceptaron / f.invitados) * 100)}%`;

function Tabla({ titulo, filas, etiqueta }: { titulo: string; filas: FilaRespuesta[]; etiqueta: (k: string) => string }) {
  return (
    <div className="min-w-0">
      <p className="eyebrow">{titulo}</p>
      <ul className="mt-2.5 space-y-2">
        {filas.slice(0, 5).map((f) => (
          <li
            key={f.clave}
            className="flex items-center justify-between gap-3 text-sm"
            title={`${f.aceptaron} aceptaron · ${f.declinaron} «ver más tarde» · ${f.otros} sin respuesta o vencidos`}
          >
            <span className="truncate text-ink-secondary">{etiqueta(f.clave)}</span>
            <span className="num shrink-0 text-xs text-ink-muted">
              <span className="font-medium text-ink-primary">{f.aceptaron}</span> de {f.invitados} · {pct(f)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * KODA se retroalimenta del puente: cada respuesta de un negocio le enseña qué rubros y ciudades
 * sí responden (aceptar suma a favor, «ver más tarde» / caducar / descartar restan un poco) y
 * sus puntajes se ajustan solos. Aquí se ve el resultado.
 */
export function AprendizajeConnexo({ envios }: { envios: ConnexoEnvio[] }) {
  const invitados = useMemo(() => envios.filter((e) => ESTADOS_INVITADOS.includes(e.estado)).length, [envios]);
  const aceptaron = useMemo(() => envios.filter((e) => e.estado === 'aceptado').length, [envios]);
  const porRubro = useMemo(() => respuestasPor(envios, 'rubro'), [envios]);
  const porCiudad = useMemo(() => respuestasPor(envios, 'ciudad'), [envios]);

  return (
    <Card className="mb-4">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0 max-w-2xl">
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-accent-text" />
            <h2 className="card-title">KODA aprende de las respuestas</h2>
          </div>
          <p className="mt-1.5 text-xs text-ink-muted">
            Cada vez que un negocio acepta, dice «ver más tarde» o no responde, KODA lo recuerda y ajusta los puntajes de tus prospectos
            parecidos. Aceptar pesa mucho a favor; aprobar un borrador suma un poco; «ver más tarde», caducar o descartar restan un poco.
            Lo aprendido se ve en <Link to="/mi-espacio" className="underline">Mi espacio</Link>.
          </p>
        </div>
        {invitados > 0 && (
          <p className="num shrink-0 text-right text-[28px] font-semibold leading-none text-ink-primary">
            {aceptaron}
            <span className="ml-1.5 text-sm font-normal text-ink-muted">de {invitados} aceptaron</span>
          </p>
        )}
      </div>

      {invitados === 0 ? (
        <p className="mt-3 text-xs text-ink-secondary">
          Aún no hay respuestas. Cuando envíes WhatsApp y los negocios respondan, aquí verás qué rubros y ciudades convierten mejor.
        </p>
      ) : (
        <div className="mt-4 grid gap-5 border-t border-line pt-4 sm:grid-cols-2">
          <Tabla titulo="Por rubro" filas={porRubro} etiqueta={(k) => RUBRO_LABEL[k] ?? k.replace(/_/g, ' ')} />
          <Tabla titulo="Por ciudad" filas={porCiudad} etiqueta={(k) => k} />
        </div>
      )}
    </Card>
  );
}
