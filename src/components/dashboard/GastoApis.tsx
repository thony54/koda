import { AlertTriangle, ExternalLink, HelpCircle, Wallet } from 'lucide-react';
import { Card } from '@/components/ui';
import { useGastoMes } from '@/hooks/useGasto';
import { GOOGLE_GRATIS_MES } from '@/lib/data/gasto';
import { formatUSD } from '@/lib/format';

const BILLING_HUB_META = 'https://business.facebook.com/billing_hub/payment_activity';
const FACTURACION_GOOGLE = 'https://console.cloud.google.com/billing';

const entero = new Intl.NumberFormat('es-EC');
const tarifaTxt = (t: number) => t.toLocaleString('es-EC', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

function Enlace({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 font-medium text-accent-text hover:underline"
    >
      {children}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

/**
 * «Gasto del mes»: lo que llevas gastado en Meta (saludos de WhatsApp) y en Google Places, al día.
 * Es una estimación hecha con lo que KODA ya sabe; el monto exacto de Meta solo vive en su Billing Hub.
 */
export function GastoApis() {
  const { data, isLoading, isError } = useGastoMes();
  const wa = data?.whatsapp ?? null;
  const g = data?.google;

  return (
    <Card className="mb-5" ember={Boolean(wa && wa.esperandoPago > 0)}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line-strong bg-surface-elevated text-accent-text">
            <Wallet className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0">
            <h2 className="card-title">Gasto del mes{data ? ` · ${data.mes}` : ''}</h2>
            <p className="mt-0.5 text-xs text-ink-muted">Estimado con tus envíos y búsquedas reales. Se actualiza solo cada 30 segundos.</p>
          </div>
        </div>
        <span className="eyebrow flex shrink-0 items-center gap-1.5">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
          En vivo
        </span>
      </div>

      {isLoading && <p className="py-6 text-center text-sm text-ink-muted">Calculando…</p>}
      {isError && <p className="py-6 text-center text-sm text-danger">No pude calcular el gasto ahora. Se reintenta solo.</p>}

      {data && g && (
        <div className={`grid grid-cols-1 gap-4 ${wa ? 'md:grid-cols-2' : ''}`}>
          {wa && (
            <div className="rounded-lg border border-line-strong bg-surface-elevated/50 p-4">
              <p className="eyebrow">Meta · WhatsApp</p>
              <p className="num mt-3 text-[30px] font-semibold leading-none text-ink-primary">≈ {formatUSD(wa.estimado)}</p>
              <p className="mt-2 text-xs text-ink-secondary">
                {entero.format(wa.entregados + wa.porConfirmar)} saludos entregados × US${tarifaTxt(wa.tarifa)}
              </p>
              <ul className="mt-3 space-y-1 text-xs text-ink-muted">
                {wa.porConfirmar > 0 && (
                  <li>{entero.format(wa.porConfirmar)} salieron y Meta aún no confirmó si llegaron (se cuentan igual).</li>
                )}
                {wa.noSalieron > 0 && <li>{entero.format(wa.noSalieron)} no salieron: Meta no los cobra.</li>}
                <li>Las respuestas dentro de las 24 h desde que el cliente te escribe son gratis.</li>
              </ul>
              {wa.esperandoPago > 0 && (
                <div className="mt-3 flex items-start gap-2 rounded-md border border-warning/35 bg-warning/10 p-3 text-xs text-warning">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <p>
                    <strong>{entero.format(wa.esperandoPago)}</strong> saludo{wa.esperandoPago === 1 ? '' : 's'} frenado
                    {wa.esperandoPago === 1 ? '' : 's'} por pagos pendientes en Meta. Paga en el Billing Hub y se reenvían.{' '}
                    <Enlace href={BILLING_HUB_META}>Abrir Billing Hub</Enlace>
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="rounded-lg border border-line-strong bg-surface-elevated/50 p-4">
            <p className="eyebrow">Google Places</p>
            <p className="num mt-3 text-[30px] font-semibold leading-none text-ink-primary">{formatUSD(g.aPagar)}</p>
            <p className="mt-2 text-xs text-ink-secondary">
              {entero.format(g.busquedas)} búsquedas este mes · las primeras {entero.format(GOOGLE_GRATIS_MES)} son gratis
            </p>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-veil/[0.07]">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${Math.min(100, (g.busquedas / GOOGLE_GRATIS_MES) * 100)}%` }}
              />
            </div>
            <p className="mt-3 text-xs text-ink-muted">
              {g.aPagar === 0
                ? `Google no te cobra nada mientras estés dentro del cupo gratis (sin él serían ${formatUSD(g.sinGratis)}).`
                : `Pasaste el cupo gratis: Google cobra cada búsqueda extra.`}
            </p>
          </div>
        </div>
      )}

      <details className="group mt-4 text-sm">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-ink-secondary hover:text-ink-primary">
          <HelpCircle className="h-4 w-4" />
          <span>¿Cómo y cuándo se paga?</span>
        </summary>
        <div className="mt-3 space-y-3 text-xs leading-relaxed text-ink-secondary">
          {wa && (
            <p>
              <strong className="text-ink-primary">Meta (WhatsApp)</strong> cobra después, no por adelantado: va sumando cada saludo entregado
              y te lo carga al método de pago que tengas en el Billing Hub cuando llegas a su umbral de facturación o en su fecha de cobro del mes.
              Si ese cobro falla o queda saldo sin pagar, Meta frena los envíos con el error 131042.
              Entra a <Enlace href={BILLING_HUB_META}>Billing Hub</Enlace>, elige tu cuenta de WhatsApp y usa «Pagar ahora».
              Conviene revisarlo antes de cada oleada y cada vez que aparezca el aviso de arriba.
            </p>
          )}
          <p>
            <strong className="text-ink-primary">Google Places</strong> te cobra a fin de mes en tu cuenta de Google Cloud, y solo lo que pase de
            las {entero.format(GOOGLE_GRATIS_MES)} búsquedas gratis. Se paga solo con la tarjeta registrada; lo revisas en{' '}
            <Enlace href={FACTURACION_GOOGLE}>Facturación de Google Cloud</Enlace>.
          </p>
          <p className="text-ink-muted">
            Las cifras de aquí son una estimación; el monto exacto que cada empresa te cobra es el que ves en su propio panel de facturación.
          </p>
        </div>
      </details>
    </Card>
  );
}
