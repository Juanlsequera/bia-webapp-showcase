import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { useTenant } from "../../lib/tenant";
import { Button, CreateButton } from "../../components/ui";
import { useTour } from "../../hooks/use-tour";
import { adminStaffSteps } from "../../lib/tours/admin-staff.tour";
import type { Staff, CreateStaffDto } from "@foodorder/types";

const DAY_LABELS: Record<string, string> = {
  monday: "Lunes",
  tuesday: "Martes",
  wednesday: "Miércoles",
  thursday: "Jueves",
  friday: "Viernes",
  saturday: "Sábado",
  sunday: "Domingo",
};
const DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

const DEFAULT_SCHEDULE = {
  monday: { open: "09:00", close: "18:00", enabled: true },
  tuesday: { open: "09:00", close: "18:00", enabled: true },
  wednesday: { open: "09:00", close: "18:00", enabled: true },
  thursday: { open: "09:00", close: "18:00", enabled: true },
  friday: { open: "09:00", close: "18:00", enabled: true },
  saturday: { open: "09:00", close: "13:00", enabled: true },
  sunday: { open: "09:00", close: "13:00", enabled: false },
  blockedDates: [] as string[],
};

export function AdminStaffPage() {
  const tenant = useTenant();
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);
  useTour("admin-staff", adminStaffSteps);

  const { data: staff = [], isLoading } = useQuery<Staff[]>({
    queryKey: ["admin-staff", tenant?.slug],
    queryFn: async () => {
      const res = await api.get(`/admin/staff`);
      return res.data || [];
    },
    enabled: !!tenant,
  });

  // R4: fetch products to use as services selector
  const { data: products = [] } = useQuery<any[]>({
    queryKey: ["admin-products-for-staff", tenant?.slug],
    queryFn: async () => {
      const res = await api.get(`/admin/products`);
      return res.data || [];
    },
    enabled: !!tenant,
  });

  const createMutation = useMutation({
    mutationFn: async (dto: CreateStaffDto) => {
      const res = await api.post(`/admin/staff`, dto);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-staff"] });
      setIsCreateOpen(false);
    },
  });

  const editMutation = useMutation({
    mutationFn: async ({
      id,
      dto,
    }: {
      id: string;
      dto: Partial<CreateStaffDto>;
    }) => {
      const res = await api.patch(`/admin/staff/${id}`, dto);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-staff"] });
      setEditingStaff(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/admin/staff/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-staff"] });
    },
  });

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div
        data-tour="staff-header"
        className="flex items-center justify-between mb-6"
      >
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Profesionales</h1>
          <p className="text-sm text-gray-500 mt-1">
            Gestiona tu equipo y horarios
          </p>
        </div>
        <CreateButton
          label="Nuevo profesional"
          dataTour="staff-create"
          onClick={() => setIsCreateOpen(true)}
        />
      </div>

      {/* Lista de staff */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-400">Cargando...</div>
        ) : staff.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-gray-400 mb-4">
              No hay profesionales registrados
            </p>
            <Button
              onClick={() => setIsCreateOpen(true)}
              className="bg-indigo-600 text-white"
            >
              Crear el primero
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table data-tour="staff-table" className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">
                    Nombre
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">
                    Servicios
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">
                    Estado
                  </th>
                  <th className="px-6 py-4 text-right text-xs font-semibold text-gray-500 uppercase">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody>
                {staff.map((s) => (
                  <tr
                    key={s._id}
                    className="border-b border-gray-100 hover:bg-gray-50"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden text-sm">
                          {s.avatar_url ? (
                            <img
                              src={s.avatar_url}
                              alt={s.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            "\u{1F464}"
                          )}
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">{s.name}</p>
                          {s.bio && (
                            <p className="text-sm text-gray-500">{s.bio}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {(s.serviceIds || []).length > 0 ? (
                        <span className="text-sm text-gray-600">
                          {s.serviceIds.length} servicio
                          {s.serviceIds.length !== 1 ? "s" : ""}
                        </span>
                      ) : (
                        <span className="text-sm text-gray-400">
                          Sin servicios
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`text-sm font-medium px-2.5 py-1 rounded-full ${
                          s.active
                            ? "bg-green-100 text-green-800"
                            : "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {s.active ? "Activo" : "Inactivo"}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div
                        data-tour="staff-actions"
                        className="flex justify-end gap-2"
                      >
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditingStaff(s)}
                        >
                          Editar
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-600"
                          onClick={() => {
                            if (confirm(`¿Eliminar a ${s.name}?`)) {
                              deleteMutation.mutate(s._id);
                            }
                          }}
                        >
                          Eliminar
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal crear */}
      {isCreateOpen && (
        <StaffModal
          title="Nuevo profesional"
          products={products}
          onSubmit={(dto) => createMutation.mutate(dto)}
          isLoading={createMutation.isPending}
          onClose={() => setIsCreateOpen(false)}
        />
      )}

      {/* Modal editar */}
      {editingStaff && (
        <StaffModal
          title="Editar profesional"
          products={products}
          initialValues={{
            name: editingStaff.name,
            bio: editingStaff.bio || "",
            avatar_url: editingStaff.avatar_url || null,
            serviceIds: editingStaff.serviceIds || [],
            schedule: (editingStaff as any).schedule || DEFAULT_SCHEDULE,
          }}
          onSubmit={(dto) => editMutation.mutate({ id: editingStaff._id, dto })}
          isLoading={editMutation.isPending}
          onClose={() => setEditingStaff(null)}
        />
      )}
    </div>
  );
}

// ─── Modal wrapper ────────────────────────────────────────────────────────────

function StaffModal({
  title,
  products,
  initialValues,
  onSubmit,
  isLoading,
  onClose,
}: {
  title: string;
  products: any[];
  initialValues?: {
    name: string;
    bio: string;
    avatar_url: string | null;
    serviceIds: string[];
    schedule?: typeof DEFAULT_SCHEDULE;
  };
  onSubmit: (dto: CreateStaffDto) => void;
  isLoading: boolean;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-bold text-gray-900 mb-4">{title}</h2>
        <StaffForm
          products={products}
          initialValues={initialValues}
          onSubmit={onSubmit}
          isLoading={isLoading}
        />
        <Button variant="ghost" className="w-full mt-3" onClick={onClose}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

// ─── Formulario ───────────────────────────────────────────────────────────────

function StaffForm({
  products,
  onSubmit,
  isLoading,
  initialValues,
}: {
  products: any[];
  onSubmit: (dto: CreateStaffDto) => void;
  isLoading: boolean;
  initialValues?: {
    name: string;
    bio: string;
    avatar_url: string | null;
    serviceIds: string[];
    schedule?: typeof DEFAULT_SCHEDULE;
  };
}) {
  const [name, setName] = useState(initialValues?.name ?? "");
  const [bio, setBio] = useState(initialValues?.bio ?? "");
  const [serviceIds, setServiceIds] = useState<string[]>(
    initialValues?.serviceIds ?? [],
  );
  const [schedule, setSchedule] = useState<typeof DEFAULT_SCHEDULE>(
    initialValues?.schedule ?? DEFAULT_SCHEDULE,
  );
  const [blockedInput, setBlockedInput] = useState(
    (initialValues?.schedule?.blockedDates ?? []).join(", "),
  );

  const toggleService = (id: string) => {
    setServiceIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  };

  const updateDay = (
    day: string,
    field: "open" | "close" | "enabled",
    value: string | boolean,
  ) => {
    setSchedule((prev) => ({
      ...prev,
      [day]: { ...prev[day as keyof typeof prev], [field]: value },
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return alert("El nombre es obligatorio");

    const blockedDates = blockedInput
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));

    onSubmit({
      name: name.trim(),
      bio: bio.trim() || null,
      avatar_url: null,
      serviceIds,
      schedule: { ...schedule, blockedDates },
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Info básica */}
      <div>
        <label className="text-sm font-medium text-gray-700 block mb-1">
          Nombre *
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="María López"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div>
        <label className="text-sm font-medium text-gray-700 block mb-1">
          Descripción / Bio
        </label>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder="Especialista en cortes modernos"
          rows={2}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
        />
      </div>

      {/* R4: Servicios que ofrece */}
      {products.length > 0 && (
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-2">
            Servicios que ofrece
          </label>
          <div className="border border-gray-200 rounded-lg divide-y max-h-40 overflow-y-auto">
            {products
              .filter((p) => p.active !== false)
              .map((p) => (
                <label
                  key={p._id}
                  className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={serviceIds.includes(p._id)}
                    onChange={() => toggleService(p._id)}
                    className="accent-indigo-600"
                  />
                  <span className="text-gray-800">{p.name}</span>
                  {p.price != null && (
                    <span className="ml-auto text-gray-400">
                      ${p.price.toFixed(2)}
                    </span>
                  )}
                </label>
              ))}
          </div>
          <p className="text-xs text-gray-400 mt-1">
            {serviceIds.length} seleccionado{serviceIds.length !== 1 ? "s" : ""}
          </p>
        </div>
      )}

      {/* R3: Horario semanal */}
      <div>
        <label className="text-sm font-medium text-gray-700 block mb-2">
          Horario semanal
        </label>
        <div className="border border-gray-200 rounded-lg divide-y">
          {DAYS.map((day) => {
            const dayData = schedule[day];
            return (
              <div key={day} className="flex items-center gap-3 px-3 py-2">
                <input
                  type="checkbox"
                  checked={dayData.enabled}
                  onChange={(e) => updateDay(day, "enabled", e.target.checked)}
                  className="accent-indigo-600 shrink-0"
                />
                <span
                  className={`w-20 text-sm shrink-0 ${dayData.enabled ? "text-gray-800" : "text-gray-400"}`}
                >
                  {DAY_LABELS[day]}
                </span>
                <input
                  type="time"
                  value={dayData.open}
                  disabled={!dayData.enabled}
                  onChange={(e) => updateDay(day, "open", e.target.value)}
                  className="border border-gray-200 rounded px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-40"
                />
                <span className="text-gray-400 text-xs">–</span>
                <input
                  type="time"
                  value={dayData.close}
                  disabled={!dayData.enabled}
                  onChange={(e) => updateDay(day, "close", e.target.value)}
                  className="border border-gray-200 rounded px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-40"
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* R3: Fechas bloqueadas */}
      <div>
        <label className="text-sm font-medium text-gray-700 block mb-1">
          Fechas bloqueadas
        </label>
        <input
          type="text"
          value={blockedInput}
          onChange={(e) => setBlockedInput(e.target.value)}
          placeholder="2026-06-15, 2026-07-04"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <p className="text-xs text-gray-400 mt-1">
          Separadas por coma, formato AAAA-MM-DD
        </p>
      </div>

      <Button
        type="submit"
        disabled={isLoading}
        className="w-full bg-indigo-600 text-white"
      >
        {isLoading ? "Guardando..." : "Guardar"}
      </Button>
    </form>
  );
}
