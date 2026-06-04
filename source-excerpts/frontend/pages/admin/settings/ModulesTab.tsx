import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ARCHETYPE_MODULE_DEFAULTS,
  type BusinessType,
  type TenantModules,
} from "@foodorder/types";
import { ConfigSwitch } from "../../../components/admin/ConfigSwitch";
import { tenantsApi } from "../../../lib/api";
import { useTenantPlan } from "../../../hooks/useTenantPlan";

type ModuleKey = keyof TenantModules;

/**
 * Módulos que requieren plan Pro o superior.
 * Deben estar alineados con PLAN_MODULE_MAP[starter] = false en plan-module-map.ts.
 * Nota: payment_links NO está aquí — es Starter para booking y service.
 */
const PRO_ONLY_MODULES: string[] = [
  "advanced_analytics",
  "delivery_zones",
  "loyalty_program",
  "finance_documents",
  "quotation_builder",
  "coupons_discounts",
  "product_variants",
];

interface ModuleMeta {
  key: ModuleKey;
  label: string;
  description: string;
}

interface ModuleSection {
  title: string;
  subtitle: string;
  modules: ModuleMeta[];
}

/** Metadata declarativa de todos los módulos, agrupados por sección. */
const SECTIONS: ModuleSection[] = [
  {
    title: "Operaciones",
    subtitle: "Funcionalidades core del día a día del negocio.",
    modules: [
      {
        key: "kitchen_kds",
        label: "Pantalla de cocina (KDS)",
        description:
          "Panel en tiempo real para la cocina — muestra comandas y permite cambiar estado",
      },
      {
        key: "scheduled_orders",
        label: "Pedidos programados",
        description: "Permitir al cliente elegir hora de entrega o retiro",
      },
      {
        key: "delivery_zones",
        label: "Zonas de delivery",
        description: "Define zonas y costos de envío según distancia",
      },
    ],
  },
  {
    title: "Catálogo avanzado",
    subtitle: "Opciones que amplían las capacidades del catálogo de productos.",
    modules: [
      {
        key: "product_variants",
        label: "Variantes de producto",
        description:
          "Permite definir tallas, colores u otras opciones por ítem",
      },
      {
        key: "product_modifiers",
        label: "Modificadores / extras",
        description:
          "Agrega opciones por producto (sin cebolla, extra queso, etc.)",
      },
      {
        key: "inventory_tracking",
        label: "Control de inventario",
        description:
          "Trackeo de stock — deshabilita el producto cuando se agota",
      },
      {
        key: "labor_pricing",
        label: "Precios por mano de obra",
        description:
          "Para negocios de servicio que cobran según horas de trabajo",
      },
      {
        key: "quotes_estimates",
        label: "Cotizaciones y presupuestos",
        description:
          "Para arquetipo servicio: gestiona solicitudes de trabajo con flujo de aprobación de precio",
      },
    ],
  },
  {
    title: "Reservas y turnos",
    subtitle: "Para negocios con agenda: salones, clínicas, barberías, etc.",
    modules: [
      {
        key: "booking",
        label: "Sistema de reservas",
        description:
          "Flujo de cita online con fecha y hora — activa BookingFlowPage",
      },
      {
        key: "staff_management",
        label: "Gestión de profesionales",
        description:
          "Asigna turnos y servicios por empleado — requiere reservas activado",
      },
    ],
  },
  {
    title: "Marketing y fidelización",
    subtitle: "Herramientas para retener y premiar a tus clientes.",
    modules: [
      {
        key: "loyalty_program",
        label: "Programa de puntos",
        description: "Acumulación y canje de puntos por compra",
      },
      {
        key: "coupons_discounts",
        label: "Cupones y descuentos",
        description:
          "Crea códigos de descuento por monto, porcentaje o producto",
      },
    ],
  },
  {
    title: "Cobros y pagos",
    subtitle: "Funcionalidades para cobrar fuera del flujo normal de pedido.",
    modules: [
      {
        key: "payment_links",
        label: "Links de pago",
        description:
          "Genera links de cobro únicos para compartir por WhatsApp o email — ideal para anticipos y cobros remotos",
      },
      {
        key: "quotation_builder",
        label: "Generador de presupuestos PDF",
        description:
          "Crea cotizaciones formales con ítems, desglose de IVA y exportación a PDF — para enviar a clientes antes de un trabajo o venta",
      },
    ],
  },
  {
    title: "Finanzas",
    subtitle:
      "Registro de ingresos y egresos con lectura automática de documentos.",
    modules: [
      {
        key: "finance_documents",
        label: "Documentos financieros",
        description:
          "Subí facturas, recibos y comprobantes — la IA extrae los datos automáticamente y los guarda como historial de ingresos/egresos",
      },
    ],
  },
];

const ARCHETYPE_LABELS: Record<BusinessType, string> = {
  food: "Comida",
  retail: "Retail / Tienda",
  booking: "Reservas",
  service: "Servicios",
};

/** true si el módulo aplica a alguno de los arquetipos del tenant. */
function isApplicable(key: ModuleKey, archetypes: BusinessType[]): boolean {
  return archetypes.some((a) => key in (ARCHETYPE_MODULE_DEFAULTS[a] ?? {}));
}

/** true si el módulo viene recomendado (default-on) en alguno de los arquetipos. */
function isRecommended(key: ModuleKey, archetypes: BusinessType[]): boolean {
  return archetypes.some((a) => ARCHETYPE_MODULE_DEFAULTS[a]?.[key] === true);
}

/**
 * Tab Módulos — habilita / deshabilita features de negocio.
 * Cada switch hace un PATCH parcial al TenantConfig versionado.
 *
 * Archetype-aware: muestra solo los módulos que aplican al/los arquetipo(s)
 * del tenant, marca los recomendados, y oculta los del resto de arquetipos
 * detrás de un toggle "ver otros módulos" (escape hatch para power users).
 */
export function ModulesTab() {
  const [showOthers, setShowOthers] = useState(false);
  const { isPro } = useTenantPlan();

  const { data: tenant } = useQuery({
    queryKey: ["tenant-me"],
    queryFn: tenantsApi.getMe,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
  });

  const archetypes: BusinessType[] =
    tenant?.business_types && tenant.business_types.length > 0
      ? tenant.business_types
      : ["food"];

  const archetypeNames = archetypes.map((a) => ARCHETYPE_LABELS[a]).join(" + ");

  // Construir secciones visibles: módulos aplicables (siempre) vs no-aplicables (bajo toggle).
  const renderSections = (predicate: (key: ModuleKey) => boolean) =>
    SECTIONS.map((section) => {
      const modules = section.modules.filter((m) => predicate(m.key));
      if (modules.length === 0) return null;
      return (
        <section
          key={section.title}
          className="bg-surface border border-border rounded-2xl p-5 space-y-1"
        >
          <div className="pb-3 border-b border-border mb-2">
            <h2 className="font-semibold text-app-text">{section.title}</h2>
            <p className="text-xs text-muted mt-1">{section.subtitle}</p>
          </div>
          {modules.map((m) => {
            const isProModule = PRO_ONLY_MODULES.includes(m.key);
            const locked = isProModule && !isPro;
            const badge = locked
              ? "Pro"
              : isRecommended(m.key, archetypes)
                ? "Recomendado"
                : undefined;
            return (
              <ConfigSwitch
                key={m.key}
                path={`modules.${m.key}`}
                label={m.label}
                description={m.description}
                badge={badge}
                disabled={locked}
              />
            );
          })}
        </section>
      );
    });

  const hasOtherModules = SECTIONS.some((s) =>
    s.modules.some((m) => !isApplicable(m.key, archetypes)),
  );

  return (
    <div className="space-y-4" data-tour="settings-modules">
      <div className="bg-primary/5 border border-primary/20 rounded-2xl px-4 py-3">
        <p className="text-sm text-app-text">
          Configuración recomendada para <strong>{archetypeNames}</strong>.
        </p>
        <p className="text-xs text-muted mt-0.5">
          Los módulos marcados como{" "}
          <span className="font-medium text-primary">Recomendado</span> vienen
          activados por defecto para tu tipo de negocio. Podés ajustarlos cuando
          quieras.
        </p>
      </div>

      {renderSections((key) => isApplicable(key, archetypes))}

      {hasOtherModules && (
        <div className="pt-1">
          <button
            type="button"
            onClick={() => setShowOthers((v) => !v)}
            className="text-sm font-medium text-muted hover:text-app-text transition-colors"
          >
            {showOthers
              ? "− Ocultar módulos de otros arquetipos"
              : "+ Ver módulos de otros arquetipos"}
          </button>

          {showOthers && (
            <div className="space-y-4 mt-3">
              <p className="text-xs text-muted">
                Estos módulos no son típicos de tu tipo de negocio, pero podés
                activarlos si los necesitás.
              </p>
              {renderSections((key) => !isApplicable(key, archetypes))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
