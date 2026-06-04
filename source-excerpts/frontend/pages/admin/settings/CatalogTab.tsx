import { ConfigSwitch } from "../../../components/admin/ConfigSwitch";

/**
 * Tab Catálogo — controla qué features del catálogo están habilitados.
 * Cada switch hace un PATCH parcial al TenantConfig versionado.
 */
export function CatalogTab() {
  return (
    <section
      data-tour="settings-catalog"
      className="bg-surface border border-border rounded-2xl p-5 space-y-1"
    >
      <div className="pb-3 border-b border-border mb-2">
        <h2 className="font-semibold text-app-text">Catálogo</h2>
        <p className="text-xs text-muted mt-1">
          Configurá las funcionalidades disponibles en tu menú / catálogo.
        </p>
      </div>

      <ConfigSwitch
        path="catalog.enableCategories"
        label="Categorías"
        description="Agrupá tus productos en categorías (Entradas, Bebidas, etc.)"
      />
      <ConfigSwitch
        path="catalog.enableImages"
        label="Imágenes de producto"
        description="Foto por producto visible al cliente"
      />
      <ConfigSwitch
        path="catalog.enableVariants"
        label="Variantes (talla / color)"
        description="Para negocios retail con diferentes opciones de un mismo ítem"
      />
      <ConfigSwitch
        path="catalog.enableModifiers"
        label="Modificadores (extras / sin)"
        description="Ej: sin cebolla, extra queso — para food"
      />
      <ConfigSwitch
        path="catalog.enableInventory"
        label="Control de inventario"
        description="Trackeo de stock — deshabilita el producto cuando se agota"
      />
      <ConfigSwitch
        path="catalog.enableDuration"
        label="Duración del servicio"
        description="Tiempo en minutos por ítem — para negocios de citas o reservas"
      />
      <ConfigSwitch
        path="catalog.enablePrepTime"
        label="Tiempo de preparación"
        description="Tiempo estimado de cocina por ítem — para food"
      />
    </section>
  );
}
