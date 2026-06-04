import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
  Package,
  ImageOff,
  Upload,
  Loader2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { productsApi, type ProductDto } from "../../lib/api";
import { extractErrorMessage } from "../../lib/extract-error-message";
import { Product } from "@foodorder/types";
import {
  Button,
  Input,
  Badge,
  Skeleton,
  EmptyState,
} from "../../components/ui";
import { formatUsd } from "../../lib/money";
import { useTour } from "../../hooks/use-tour";
import { TourTrigger } from "../../components/tour/TourTrigger";
import { adminProductsSteps } from "../../lib/tours/admin-products.tour";

// ── types ─────────────────────────────────────────────────────────────────────

import type { ProductVariant } from "@foodorder/types";

interface ProductForm {
  name: string;
  description: string;
  price: string;
  compare_price: string; // '' = sin precio tachado
  category: string;
  type: string; // 'physical' | 'prepared' | 'service' | 'labor'
  image_url: string;
  image_public_id: string;
  stock_enabled: boolean;
  stock_qty: string; // '' = sin tracking, número = cantidad
  variants_enabled: boolean;
  variants: ProductVariant[];
  prep_time_minutes: string;
  duration_minutes: string;
  // Disponibilidad programada
  availability_mode: "always" | "scheduled";
  availability_startDate: string; // 'YYYY-MM-DD' o ''
  availability_endDate: string;
  availability_daysOfWeek: number[]; // 0=Dom…6=Sáb; [] = todos
  availability_timeStart: string; // 'HH:MM' o ''
  availability_timeEnd: string;
  availability_whenUnavailable: "hide" | "show_disabled";
}

const EMPTY_FORM: ProductForm = {
  name: "",
  description: "",
  price: "",
  compare_price: "",
  category: "",
  type: "prepared",
  image_url: "",
  image_public_id: "",
  stock_enabled: false,
  stock_qty: "",
  variants_enabled: false,
  variants: [],
  prep_time_minutes: "",
  duration_minutes: "",
  availability_mode: "always",
  availability_startDate: "",
  availability_endDate: "",
  availability_daysOfWeek: [],
  availability_timeStart: "",
  availability_timeEnd: "",
  availability_whenUnavailable: "show_disabled",
};

// ── page ──────────────────────────────────────────────────────────────────────

export function AdminProductsPage() {
  const qc = useQueryClient();
  const [modal, setModal] = useState<
    { open: false } | { open: true; editing: Product | null }
  >({
    open: false,
  });
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);

  const { data: products = [], isLoading } = useQuery<Product[]>({
    queryKey: ["admin-products"],
    queryFn: productsApi.list,
    // On-demand: fetch al entrar; las mutaciones invalidan la query.
    refetchOnWindowFocus: false,
  });

  const create = useMutation({
    mutationFn: (dto: ProductDto) => productsApi.create(dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-products"] });
      toast.success("Producto creado");
    },
    onError: (err) =>
      toast.error(extractErrorMessage(err, "No se pudo crear el producto")),
  });

  const update = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: ProductDto }) =>
      productsApi.update(id, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-products"] });
      toast.success("Producto actualizado");
    },
    onError: (err) =>
      toast.error(extractErrorMessage(err, "No se pudo guardar los cambios")),
  });

  const toggle = useMutation({
    mutationFn: (id: string) => productsApi.toggle(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-products"] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => productsApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-products"] });
      toast.success("Producto eliminado");
      setDeleteTarget(null);
    },
  });

  // Agrupar por categoría
  const grouped = products.reduce<Record<string, Product[]>>((acc, p) => {
    acc[p.category] = [...(acc[p.category] ?? []), p];
    return acc;
  }, {});
  const categories = Object.keys(grouped).sort();

  const { start: startTour } = useTour("admin-products", adminProductsSteps);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <TourTrigger onStart={startTour} />
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-app-text">Productos</h1>
          <p className="text-sm text-muted">
            {products.length} productos · {categories.length} categorías
          </p>
        </div>
        <Button
          size="sm"
          data-tour="products-add-btn"
          onClick={() => setModal({ open: true, editing: null })}
        >
          <Plus size={16} className="mr-1.5" />
          Nuevo producto
        </Button>
      </div>

      {/* Skeleton */}
      {isLoading && (
        <div className="space-y-6">
          {[0, 1].map((s) => (
            <div key={s} className="space-y-2">
              <Skeleton className="h-3.5 w-28 mb-3" />
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="bg-surface border border-border rounded-2xl p-3 flex items-center gap-3"
                >
                  <Skeleton className="w-14 h-14 rounded-xl flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                  <Skeleton className="h-8 w-16 rounded-xl" />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Empty */}
      {!isLoading && products.length === 0 && (
        <EmptyState
          icon={Package}
          title="Sin productos"
          description="Agrega el primer producto para que aparezca en el menú."
          action={
            <Button
              size="sm"
              onClick={() => setModal({ open: true, editing: null })}
            >
              <Plus size={15} className="mr-1" />
              Crear producto
            </Button>
          }
        />
      )}

      {/* Lista por categoría */}
      {categories.map((cat, idx) => (
        <section
          key={cat}
          className="animate-slide-up"
          {...(idx === 0 ? { "data-tour": "products-list" } : {})}
        >
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted mb-2 px-1">
            {cat}
          </h2>
          <div className="space-y-2">
            {grouped[cat].map((p) => (
              <ProductRow
                key={p._id}
                product={p}
                onEdit={() => setModal({ open: true, editing: p })}
                onToggle={() => toggle.mutate(p._id)}
                onDelete={() => setDeleteTarget(p)}
                disabled={toggle.isPending || remove.isPending}
              />
            ))}
          </div>
        </section>
      ))}

      {/* Modal crear/editar */}
      {modal.open && (
        <ProductModal
          editing={modal.editing}
          categories={categories}
          onClose={() => setModal({ open: false })}
          onSave={async (dto) => {
            if (modal.editing) {
              await update.mutateAsync({ id: modal.editing._id, dto });
            } else {
              await create.mutateAsync(dto);
            }
            setModal({ open: false });
          }}
          isSaving={create.isPending || update.isPending}
        />
      )}

      {/* Confirm delete */}
      {deleteTarget && (
        <ConfirmDialog
          title="Eliminar producto"
          message={`¿Eliminar "${deleteTarget.name}"? Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          danger
          onConfirm={() => remove.mutate(deleteTarget._id)}
          onCancel={() => setDeleteTarget(null)}
          loading={remove.isPending}
        />
      )}
    </div>
  );
}

// ── ProductRow ─────────────────────────────────────────────────────────────────

function ProductRow({
  product,
  onEdit,
  onToggle,
  onDelete,
  disabled,
}: {
  product: Product;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
  disabled: boolean;
}) {
  return (
    <div
      className={`bg-surface border border-border rounded-2xl p-3 flex items-center gap-3 transition-opacity ${!product.active ? "opacity-60" : ""}`}
    >
      {/* Thumbnail */}
      <div
        data-tour="products-image"
        className="w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 bg-bg border border-border flex items-center justify-center"
      >
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <ImageOff size={18} className="text-muted" />
        )}
      </div>

      {/* Info */}
      <div data-tour="products-stock" className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-semibold text-app-text text-sm truncate">
            {product.name}
          </p>
          {!product.active && <Badge variant="neutral">Inactivo</Badge>}
          {product.active &&
            product.stock_enabled &&
            (product.stock_qty ?? 0) >= 0 &&
            (product.stock_qty ?? 1) <= 5 && (
              <Badge variant="warning">Stock bajo ({product.stock_qty})</Badge>
            )}
        </div>
        {product.description && (
          <p className="text-xs text-muted truncate mt-0.5">
            {product.description}
          </p>
        )}
        <p className="text-sm font-bold text-primary mt-0.5">
          {formatUsd(product.price)}
        </p>
      </div>

      {/* Acciones */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <IconBtn
          onClick={onToggle}
          disabled={disabled}
          title={product.active ? "Desactivar" : "Activar"}
          data-tour="products-toggle"
        >
          {product.active ? <EyeOff size={16} /> : <Eye size={16} />}
        </IconBtn>
        <IconBtn onClick={onEdit} disabled={disabled} title="Editar">
          <Pencil size={16} />
        </IconBtn>
        <IconBtn onClick={onDelete} disabled={disabled} title="Eliminar" danger>
          <Trash2 size={16} />
        </IconBtn>
      </div>
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  disabled,
  title,
  danger = false,
  ...rest
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
  title: string;
  danger?: boolean;
  [key: string]: unknown;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`p-2 rounded-xl transition-colors disabled:opacity-40 ${
        danger
          ? "text-muted hover:text-red-500 hover:bg-red-50"
          : "text-muted hover:text-app-text hover:bg-bg"
      }`}
      {...rest}
    >
      {children}
    </button>
  );
}

// ── AvailabilityBadge — live preview en el form ───────────────────────────────

function AvailabilityBadge({ form }: { form: ProductForm }) {
  if (form.availability_mode === "always") {
    return (
      <span className="text-xs text-green-600 font-medium">
        ✓ Siempre disponible
      </span>
    );
  }
  const DAY_NAMES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  const parts: string[] = [];
  if (form.availability_startDate || form.availability_endDate) {
    parts.push(
      `${form.availability_startDate || "…"} → ${form.availability_endDate || "…"}`,
    );
  }
  if (form.availability_daysOfWeek.length > 0) {
    parts.push(
      form.availability_daysOfWeek.map((d) => DAY_NAMES[d]).join(", "),
    );
  }
  if (form.availability_timeStart || form.availability_timeEnd) {
    parts.push(
      `${form.availability_timeStart || "00:00"} – ${form.availability_timeEnd || "23:59"}`,
    );
  }
  if (parts.length === 0) {
    return (
      <span className="text-xs text-amber-600 font-medium">
        ⚠ Sin restricciones aún
      </span>
    );
  }
  return (
    <span className="text-xs text-amber-600 font-medium">
      🕑 {parts.join(" · ")}
    </span>
  );
}

// ── CategorySelect ─────────────────────────────────────────────────────────────

/**
 * Select de categoría: muestra las categorías existentes del tenant.
 * Al elegir "+ Nueva categoría" despliega un input inline para escribir una nueva.
 */
function CategorySelect({
  categories,
  value,
  onChange,
}: {
  categories: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const NEW_SENTINEL = "__new__";
  const isNew = value !== "" && !categories.includes(value);
  const [showInput, setShowInput] = useState(isNew);
  const [inputVal, setInputVal] = useState(isNew ? value : "");

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (e.target.value === NEW_SENTINEL) {
      setShowInput(true);
      setInputVal("");
      onChange("");
    } else {
      setShowInput(false);
      onChange(e.target.value);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputVal(e.target.value);
    onChange(e.target.value);
  };

  // Valor del select: si showInput → sentinel; si value está en lista → value; else → ''
  const selectVal = showInput
    ? NEW_SENTINEL
    : categories.includes(value)
      ? value
      : value === ""
        ? ""
        : NEW_SENTINEL;

  return (
    <div>
      <label className="text-sm font-medium text-app-text block mb-1.5">
        Categoría *
      </label>
      <select
        value={selectVal}
        onChange={handleSelectChange}
        className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-bg text-app-text focus:outline-none focus:border-primary"
      >
        <option value="" disabled>
          Elegí una categoría…
        </option>
        {categories.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
        <option value={NEW_SENTINEL}>+ Nueva categoría</option>
      </select>
      {showInput && (
        <input
          autoFocus
          type="text"
          value={inputVal}
          onChange={handleInputChange}
          placeholder="Nombre de la nueva categoría"
          maxLength={40}
          className="mt-2 w-full border border-primary rounded-xl px-3 py-2 text-sm bg-bg text-app-text focus:outline-none focus:border-primary placeholder-muted"
        />
      )}
    </div>
  );
}

// ── ProductModal ───────────────────────────────────────────────────────────────

function ProductModal({
  editing,
  categories,
  onClose,
  onSave,
  isSaving,
}: {
  editing: Product | null;
  categories: string[];
  onClose: () => void;
  onSave: (dto: ProductDto) => Promise<void>;
  isSaving: boolean;
}) {
  const [form, setForm] = useState<ProductForm>(EMPTY_FORM);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (editing) {
      // Preferir stock_qty (nuevo); fallback a stockQuantity (legacy)
      const stockVal = editing.stock_qty ?? (editing as any).stockQuantity;
      const avail = (editing as any).availability;
      setForm({
        name: editing.name,
        description: editing.description ?? "",
        price: String(editing.price),
        compare_price:
          editing.compare_price != null ? String(editing.compare_price) : "",
        category: editing.category,
        type: (editing as any).type ?? "prepared",
        image_url: editing.image_url ?? "",
        image_public_id: (editing as any).image_public_id ?? "",
        stock_enabled: editing.stock_enabled ?? false,
        stock_qty: stockVal != null ? String(stockVal) : "",
        variants_enabled: editing.variants_enabled ?? false,
        variants: (editing.variants ?? []) as ProductVariant[],
        prep_time_minutes:
          editing.prep_time_minutes != null
            ? String(editing.prep_time_minutes)
            : "",
        duration_minutes:
          editing.duration_minutes != null
            ? String(editing.duration_minutes)
            : "",
        availability_mode: (avail?.mode ?? "always") as "always" | "scheduled",
        availability_startDate: avail?.startDate
          ? String(avail.startDate).slice(0, 10)
          : "",
        availability_endDate: avail?.endDate
          ? String(avail.endDate).slice(0, 10)
          : "",
        availability_daysOfWeek: avail?.daysOfWeek ?? [],
        availability_timeStart: avail?.timeStart ?? "",
        availability_timeEnd: avail?.timeEnd ?? "",
        availability_whenUnavailable: (avail?.whenUnavailable ??
          "show_disabled") as "hide" | "show_disabled",
      });
    } else {
      setForm(EMPTY_FORM);
    }
  }, [editing]);

  const set = (k: keyof ProductForm, v: string | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    const price = parseFloat(form.price);
    if (!form.name.trim()) return setError("El nombre es requerido.");
    if (isNaN(price) || price <= 0)
      return setError("El precio debe ser un número mayor a 0.");
    if (!form.category.trim()) return setError("La categoría es requerida.");
    setError("");

    const stock_qty =
      form.stock_qty.trim() !== ""
        ? Math.max(0, parseInt(form.stock_qty, 10))
        : null;
    const compare_price =
      form.compare_price.trim() !== ""
        ? Math.max(0, parseFloat(form.compare_price))
        : null;
    const prep_time_minutes =
      form.prep_time_minutes.trim() !== ""
        ? Math.max(1, parseInt(form.prep_time_minutes, 10))
        : null;
    const duration_minutes =
      form.duration_minutes.trim() !== ""
        ? Math.max(1, parseInt(form.duration_minutes, 10))
        : null;

    const availability =
      form.availability_mode === "scheduled"
        ? {
            mode: "scheduled" as const,
            startDate: form.availability_startDate || null,
            endDate: form.availability_endDate || null,
            daysOfWeek: form.availability_daysOfWeek,
            timeStart: form.availability_timeStart || null,
            timeEnd: form.availability_timeEnd || null,
            whenUnavailable: form.availability_whenUnavailable,
          }
        : {
            mode: "always" as const,
            startDate: null,
            endDate: null,
            daysOfWeek: [] as number[],
            timeStart: null,
            timeEnd: null,
            whenUnavailable: "show_disabled" as const,
          };

    await onSave({
      name: form.name.trim(),
      description: form.description.trim(),
      price,
      compare_price,
      category: form.category.trim(),
      type: form.type,
      image_url: form.image_url.trim() || null,
      image_public_id: form.image_public_id.trim() || null,
      stock_enabled: form.stock_enabled,
      stock_qty,
      variants_enabled: form.variants_enabled,
      variants: form.variants,
      prep_time_minutes,
      duration_minutes,
      availability,
    } as any);
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="product-modal-title"
    >
      <div className="w-full sm:max-w-lg bg-surface rounded-t-2xl sm:rounded-2xl border border-border shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="p-5 border-b border-border flex items-center justify-between">
          <h2 id="product-modal-title" className="font-bold text-app-text">
            {editing ? "Editar producto" : "Nuevo producto"}
          </h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-app-text text-xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Tipo de producto */}
          <div>
            <label className="text-sm font-medium text-app-text block mb-1.5">
              Tipo de producto
            </label>
            <select
              value={form.type}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  type: e.target.value,
                  variants_enabled:
                    e.target.value === "physical" ? f.variants_enabled : false,
                }))
              }
              className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-bg text-app-text focus:outline-none focus:border-primary"
            >
              <option value="prepared">🍔 Comida preparada</option>
              <option value="physical">📦 Producto físico (retail)</option>
              <option value="service">📅 Servicio (agenda)</option>
              <option value="labor">🔧 Trabajo técnico (cotización)</option>
            </select>
          </div>

          <Input
            label="Nombre *"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="ej: Hamburguesa clásica"
            maxLength={80}
          />

          <div>
            <label className="text-sm font-medium text-app-text block mb-1.5">
              Descripción
            </label>
            <textarea
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Ingredientes, alergenos, etc."
              maxLength={400}
              rows={2}
              className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-bg text-app-text focus:outline-none focus:border-primary resize-none placeholder-muted"
            />
            <p className="text-xs text-muted text-right mt-0.5">
              {form.description.length}/400
            </p>
          </div>

          <Input
            label="Precio (USD) *"
            type="number"
            min="0.01"
            step="0.01"
            value={form.price}
            onChange={(e) => set("price", e.target.value)}
            placeholder="0.00"
          />

          {/* Categoría: select con las existentes + opción "Nueva categoría" */}
          <CategorySelect
            categories={categories}
            value={form.category}
            onChange={(v) => set("category", v)}
          />

          {/* Imagen del producto — file picker + fallback URL */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-app-text block">
              Imagen del producto
            </label>

            {/* Zona de upload */}
            <label
              className={`flex items-center gap-3 border-2 border-dashed rounded-xl px-4 py-3 cursor-pointer transition-colors
              ${uploading ? "border-primary/40 bg-primary/5" : "border-border hover:border-primary/50 hover:bg-primary/5"}`}
            >
              {uploading ? (
                <Loader2
                  size={18}
                  className="text-primary animate-spin flex-shrink-0"
                />
              ) : (
                <Upload size={18} className="text-muted flex-shrink-0" />
              )}
              <span className="text-sm text-muted">
                {uploading
                  ? "Subiendo imagen..."
                  : "Seleccioná una imagen (PNG, JPG, WebP · máx 5 MB)"}
              </span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                disabled={uploading || isSaving}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setUploading(true);
                  try {
                    const { url, publicId } =
                      await productsApi.uploadImage(file);
                    set("image_url", url);
                    set("image_public_id", publicId ?? "");
                    toast.success("Imagen subida");
                  } catch {
                    toast.error("No se pudo subir la imagen");
                  } finally {
                    setUploading(false);
                    e.target.value = "";
                  }
                }}
              />
            </label>

            {/* Fallback: pegar URL directamente (sin publicId — no es de Cloudinary) */}
            <input
              type="url"
              value={form.image_url}
              onChange={(e) => {
                set("image_url", e.target.value);
                // URL manual → no hay publicId de Cloudinary para cleanup
                if (form.image_public_id) set("image_public_id", "");
              }}
              placeholder="O pegá una URL de imagen directamente"
              className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-bg text-app-text focus:outline-none focus:border-primary placeholder-muted"
            />
          </div>

          {/* Preview de imagen */}
          {form.image_url && (
            <div className="rounded-xl overflow-hidden border border-border h-32 bg-bg">
              <img
                src={form.image_url}
                alt="Preview"
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            </div>
          )}

          {/* Precio tachado (compare_price) */}
          <Input
            label="Precio antes de la oferta (opcional)"
            type="number"
            min="0"
            step="0.01"
            value={form.compare_price}
            onChange={(e) => set("compare_price", e.target.value)}
            placeholder="ej: 12.00 (se muestra tachado)"
          />

          {/* ── Disponibilidad programada ─────────────────────────────── */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <label className="text-sm font-medium text-app-text">
                Disponibilidad
              </label>
              <AvailabilityBadge form={form} />
            </div>

            <div className="flex gap-5">
              {(["always", "scheduled"] as const).map((mode) => (
                <label
                  key={mode}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <input
                    type="radio"
                    name={`avail-mode-${editing?._id ?? "new"}`}
                    checked={form.availability_mode === mode}
                    onChange={() =>
                      setForm((f) => ({ ...f, availability_mode: mode }))
                    }
                    className="accent-primary"
                  />
                  <span className="text-sm text-app-text">
                    {mode === "always" ? "Siempre disponible" : "Programada"}
                  </span>
                </label>
              ))}
            </div>

            {form.availability_mode === "scheduled" && (
              <div className="space-y-3 pt-3 border-t border-border">
                {/* Rango de fechas */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted block mb-1">
                      Fecha desde (opcional)
                    </label>
                    <input
                      type="date"
                      value={form.availability_startDate}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          availability_startDate: e.target.value,
                        }))
                      }
                      className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-bg text-app-text focus:outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted block mb-1">
                      Fecha hasta (opcional)
                    </label>
                    <input
                      type="date"
                      value={form.availability_endDate}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          availability_endDate: e.target.value,
                        }))
                      }
                      className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-bg text-app-text focus:outline-none focus:border-primary"
                    />
                  </div>
                </div>

                {/* Días de la semana */}
                <div>
                  <label className="text-xs font-medium text-muted block mb-1.5">
                    Días disponibles
                  </label>
                  <div className="flex gap-1.5 flex-wrap">
                    {["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"].map(
                      (day, i) => {
                        const active = form.availability_daysOfWeek.includes(i);
                        return (
                          <button
                            key={i}
                            type="button"
                            onClick={() =>
                              setForm((f) => ({
                                ...f,
                                availability_daysOfWeek: active
                                  ? f.availability_daysOfWeek.filter(
                                      (d) => d !== i,
                                    )
                                  : [...f.availability_daysOfWeek, i],
                              }))
                            }
                            className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${
                              active
                                ? "bg-primary text-white"
                                : "border border-border text-muted hover:border-primary/60"
                            }`}
                          >
                            {day}
                          </button>
                        );
                      },
                    )}
                  </div>
                  <p className="text-xs text-muted mt-1">
                    Sin selección = todos los días
                  </p>
                </div>

                {/* Franja horaria */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted block mb-1">
                      Hora inicio (opcional)
                    </label>
                    <input
                      type="time"
                      value={form.availability_timeStart}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          availability_timeStart: e.target.value,
                        }))
                      }
                      className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-bg text-app-text focus:outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted block mb-1">
                      Hora fin (opcional)
                    </label>
                    <input
                      type="time"
                      value={form.availability_timeEnd}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          availability_timeEnd: e.target.value,
                        }))
                      }
                      className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-bg text-app-text focus:outline-none focus:border-primary"
                    />
                  </div>
                </div>
                <p className="text-xs text-muted">
                  Sin horas = disponible todo el día. Admite ventanas que cruzan
                  medianoche (ej: 22:00 → 02:00).
                </p>

                {/* Comportamiento cuando no está disponible */}
                <div>
                  <label className="text-xs font-medium text-muted block mb-1.5">
                    Cuando no está disponible
                  </label>
                  <div className="flex gap-5">
                    {(
                      [
                        { val: "show_disabled", label: "Mostrar bloqueado" },
                        { val: "hide", label: "Ocultar del menú" },
                      ] as const
                    ).map(({ val, label }) => (
                      <label
                        key={val}
                        className="flex items-center gap-2 cursor-pointer"
                      >
                        <input
                          type="radio"
                          name={`avail-when-${editing?._id ?? "new"}`}
                          checked={form.availability_whenUnavailable === val}
                          onChange={() =>
                            setForm((f) => ({
                              ...f,
                              availability_whenUnavailable: val,
                            }))
                          }
                          className="accent-primary"
                        />
                        <span className="text-sm text-app-text">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Tiempo de preparación — solo para food */}
          {form.type === "prepared" && (
            <Input
              label="Tiempo de preparación (minutos)"
              type="number"
              min="1"
              step="1"
              value={form.prep_time_minutes}
              onChange={(e) => set("prep_time_minutes", e.target.value)}
              placeholder="ej: 15"
            />
          )}

          {/* Duración — solo para service/labor */}
          {(form.type === "service" || form.type === "labor") && (
            <Input
              label="Duración del servicio (minutos)"
              type="number"
              min="1"
              step="1"
              value={form.duration_minutes}
              onChange={(e) => set("duration_minutes", e.target.value)}
              placeholder="ej: 60"
            />
          )}

          {/* Control de stock (para physical y prepared) */}
          {(form.type === "physical" || form.type === "prepared") && (
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.stock_enabled}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      stock_enabled: e.target.checked,
                      stock_qty: e.target.checked ? f.stock_qty : "",
                    }))
                  }
                  className="rounded"
                />
                <span className="text-sm font-medium text-app-text">
                  Activar control de stock
                </span>
              </label>
              {form.stock_enabled && (
                <div>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={form.stock_qty}
                    onChange={(e) => set("stock_qty", e.target.value)}
                    placeholder="Cantidad disponible"
                    className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-bg text-app-text focus:outline-none focus:border-primary placeholder-muted"
                  />
                  <p className="text-xs text-muted mt-1">
                    {form.stock_qty === "" || form.stock_qty === "0"
                      ? '0 = se mostrará como "Agotado" en el catálogo.'
                      : `${form.stock_qty} unidades disponibles. Se descuenta al confirmar cada pedido.`}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Editor de variantes — solo para physical */}
          {form.type === "physical" && (
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.variants_enabled}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      variants_enabled: e.target.checked,
                    }))
                  }
                  className="rounded"
                />
                <span className="text-sm font-medium text-app-text">
                  Activar variantes (talla, color, etc.)
                </span>
              </label>
              {form.variants_enabled && (
                <VariantEditor
                  variants={form.variants}
                  onChange={(variants) => setForm((f) => ({ ...f, variants }))}
                />
              )}
            </div>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>

        <div className="p-5 border-t border-border flex gap-3">
          <Button
            variant="secondary"
            className="flex-1"
            onClick={onClose}
            disabled={isSaving}
          >
            Cancelar
          </Button>
          <Button className="flex-1" loading={isSaving} onClick={handleSubmit}>
            {editing ? "Guardar cambios" : "Crear producto"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── VariantEditor ──────────────────────────────────────────────────────────────

function VariantEditor({
  variants,
  onChange,
}: {
  variants: ProductVariant[];
  onChange: (v: ProductVariant[]) => void;
}) {
  const [draft, setDraft] = useState<Omit<ProductVariant, "_id">>({
    name: "",
    options: {},
    price_override: null,
    stock_qty: undefined,
    sku: null,
  });
  const [optKey, setOptKey] = useState("");
  const [optVal, setOptVal] = useState("");
  const [adding, setAdding] = useState(false);

  const addOption = () => {
    if (!optKey.trim() || !optVal.trim()) return;
    setDraft((d) => ({
      ...d,
      options: { ...d.options, [optKey.trim()]: optVal.trim() },
    }));
    setOptKey("");
    setOptVal("");
  };
  const removeOption = (key: string) => {
    setDraft((d) => {
      const opts = { ...d.options };
      delete opts[key];
      return { ...d, options: opts };
    });
  };
  const confirmAdd = () => {
    if (!draft.name.trim()) return;
    onChange([...variants, { ...draft, _id: Date.now().toString() }]);
    setDraft({
      name: "",
      options: {},
      price_override: null,
      stock_qty: undefined,
      sku: null,
    });
    setAdding(false);
  };
  const removeVariant = (idx: number) =>
    onChange(variants.filter((_, i) => i !== idx));

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      {/* Lista de variantes existentes */}
      {variants.length > 0 && (
        <div className="divide-y divide-border">
          {variants.map((v, idx) => (
            <div
              key={v._id || idx}
              className="flex items-center gap-2 px-3 py-2"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-app-text truncate">
                  {v.name}
                </p>
                <p className="text-xs text-muted">
                  {Object.entries(v.options)
                    .map(([k, val]) => `${k}: ${val}`)
                    .join(" · ")}
                  {v.price_override != null
                    ? ` · $${v.price_override.toFixed(2)}`
                    : ""}
                  {v.stock_qty != null ? ` · stock: ${v.stock_qty}` : ""}
                </p>
              </div>
              <button
                onClick={() => removeVariant(idx)}
                className="text-muted hover:text-red-500 p-1"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Form para agregar variante */}
      {adding ? (
        <div className="p-3 space-y-2 bg-bg/50">
          <input
            type="text"
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            placeholder="Nombre de la variante (ej: Azul / M)"
            className="w-full border border-border rounded-lg px-2.5 py-1.5 text-sm bg-bg text-app-text focus:outline-none focus:border-primary placeholder-muted"
          />

          {/* Opciones key/value */}
          <div className="space-y-1">
            {Object.entries(draft.options).map(([k, val]) => (
              <div key={k} className="flex items-center gap-1 text-xs">
                <span className="bg-border/60 px-2 py-0.5 rounded">
                  {k}: {val}
                </span>
                <button
                  onClick={() => removeOption(k)}
                  className="text-muted hover:text-red-500"
                >
                  <X size={10} />
                </button>
              </div>
            ))}
            <div className="flex gap-1">
              <input
                type="text"
                value={optKey}
                onChange={(e) => setOptKey(e.target.value)}
                placeholder="Atributo (ej: talla)"
                className="flex-1 border border-border rounded-lg px-2 py-1 text-xs bg-bg text-app-text focus:outline-none focus:border-primary placeholder-muted"
              />
              <input
                type="text"
                value={optVal}
                onChange={(e) => setOptVal(e.target.value)}
                placeholder="Valor (ej: M)"
                onKeyDown={(e) => e.key === "Enter" && addOption()}
                className="flex-1 border border-border rounded-lg px-2 py-1 text-xs bg-bg text-app-text focus:outline-none focus:border-primary placeholder-muted"
              />
              <button
                onClick={addOption}
                className="text-xs px-2 py-1 bg-border/60 rounded-lg hover:bg-border"
              >
                +
              </button>
            </div>
          </div>

          <div className="flex gap-2">
            <input
              type="number"
              value={draft.price_override ?? ""}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  price_override:
                    e.target.value !== "" ? parseFloat(e.target.value) : null,
                }))
              }
              placeholder="Precio override (opcional)"
              min="0"
              step="0.01"
              className="flex-1 border border-border rounded-lg px-2.5 py-1.5 text-xs bg-bg text-app-text focus:outline-none focus:border-primary placeholder-muted"
            />
            <input
              type="number"
              value={draft.stock_qty ?? ""}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  stock_qty:
                    e.target.value !== ""
                      ? parseInt(e.target.value)
                      : undefined,
                }))
              }
              placeholder="Stock (opcional)"
              min="0"
              className="flex-1 border border-border rounded-lg px-2.5 py-1.5 text-xs bg-bg text-app-text focus:outline-none focus:border-primary placeholder-muted"
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => {
                setAdding(false);
                setDraft({
                  name: "",
                  options: {},
                  price_override: null,
                  stock_qty: undefined,
                  sku: null,
                });
              }}
              className="flex-1 text-xs py-1.5 rounded-lg border border-border text-muted hover:text-app-text"
            >
              Cancelar
            </button>
            <button
              onClick={confirmAdd}
              disabled={!draft.name.trim()}
              className="flex-1 text-xs py-1.5 rounded-lg bg-primary text-white disabled:opacity-40"
            >
              Agregar variante
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="w-full text-xs py-2 text-primary hover:bg-primary/5 transition-colors"
        >
          + Agregar variante
        </button>
      )}
    </div>
  );
}

// ── ConfirmDialog ──────────────────────────────────────────────────────────────

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger = false,
  onConfirm,
  onCancel,
  loading,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div
        className="w-full max-w-sm bg-surface rounded-2xl border border-border p-6 space-y-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-dialog-title" className="font-bold text-app-text">
          {title}
        </h2>
        <p className="text-sm text-muted">{message}</p>
        <div className="flex gap-3">
          <Button
            variant="secondary"
            className="flex-1"
            onClick={onCancel}
            disabled={loading}
          >
            Cancelar
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            className="flex-1"
            loading={loading}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
