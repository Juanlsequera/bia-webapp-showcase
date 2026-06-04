import { ConfigSwitch } from "../../../components/admin/ConfigSwitch";
import { useTenantConfig } from "../../../hooks/useTenantConfig";
import { BankAccountsManager } from "./BankAccountsManager";
import { TransferAccountsManager } from "./TransferAccountsManager";
import { ZelleAccountsManager } from "./ZelleAccountsManager";

/**
 * Tab Pagos — unifica todo lo relacionado al cobro:
 *  1. Cuentas PagoMóvil (datos que el cliente ve para transferir)
 *  2. Métodos de pago habilitados (efectivo, PagoMóvil, Stripe, etc.)
 *  3. Aprobación automática por método
 *
 * Las cuentas PagoMóvil estaban antes en la pestaña Negocio — se movieron acá
 * en 2026-05-25 para que toda la config de cobro viva en un solo lugar.
 */
export function PaymentsTab() {
  const { config } = useTenantConfig();
  const providers = (config?.payments as Record<string, unknown>)?.providers as
    | Record<string, { enabled?: boolean }>
    | undefined;

  const pagomovilEnabled = providers?.pagomovil?.enabled ?? true;
  const stripeEnabled = providers?.stripe?.enabled ?? false;
  const mpEnabled = providers?.mercadopago?.enabled ?? false;

  return (
    <div className="space-y-4">
      {/* Cuentas PagoMóvil — movido desde Negocio (2026-05-25) */}
      <div data-tour="settings-bank-accounts">
        <BankAccountsManager />
      </div>

      {/* Cuentas Transferencia bancaria */}
      <TransferAccountsManager />

      {/* Cuentas Zelle */}
      <ZelleAccountsManager />

      {/* Proveedores disponibles */}
      <section
        data-tour="settings-payment-methods"
        className="bg-surface border border-border rounded-2xl p-5 space-y-1"
      >
        <div className="pb-3 border-b border-border mb-2">
          <h2 className="font-semibold text-app-text">Métodos de pago</h2>
          <p className="text-xs text-muted mt-1">
            Habilitá los métodos que acepta tu negocio. Los proveedores
            deshabilitados no aparecerán al cliente al hacer el pedido.
          </p>
        </div>

        <ConfigSwitch
          path="payments.providers.cash.enabled"
          label="Efectivo"
          description="El cliente paga en caja al retirar o recibir el pedido"
        />
        <ConfigSwitch
          path="payments.providers.pagomovil.enabled"
          label="PagoMóvil"
          description="Transferencia inmediata venezolana (requiere comprobante)"
        />
        {/* <ConfigSwitch
          path="payments.providers.bankTransfer.enabled"
          label="Transferencia bancaria"
          description="Depósito bancario con comprobante"
        /> */}
        <ConfigSwitch
          path="payments.providers.stripe.enabled"
          label="Stripe"
          description="Tarjeta de crédito / débito internacional"
          disabled={!stripeEnabled}
        />
        <ConfigSwitch
          path="payments.providers.mercadopago.enabled"
          label="MercadoPago"
          description="Pagos en línea para LATAM"
          disabled={!mpEnabled}
        />
      </section>

      {/* Auto-aprobación */}
      <section className="bg-surface border border-border rounded-2xl p-5 space-y-1">
        <div className="pb-3 border-b border-border mb-2">
          <h2 className="font-semibold text-app-text">Aprobación automática</h2>
          <p className="text-xs text-muted mt-1">
            Si está activo, los pedidos con ese método pasan directo a
            "preparando" sin revisión manual.
          </p>
        </div>

        <ConfigSwitch
          path="payments.autoApprove.cash"
          label="Auto-aprobar efectivo"
          description="El cajero cobra sin tener que tocar 'Confirmar pago'"
        />
        <ConfigSwitch
          path="payments.autoApprove.pagomovil"
          label="Auto-aprobar PagoMóvil"
          description="Omite la verificación manual del comprobante"
          disabled={!pagomovilEnabled}
        />
        {/* <ConfigSwitch
          path="payments.autoApprove.bankTransfer"
          label="Auto-aprobar transferencia"
          description="Sin revisión del comprobante de depósito"
        /> */}
      </section>
    </div>
  );
}
