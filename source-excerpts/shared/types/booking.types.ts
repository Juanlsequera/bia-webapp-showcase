// ─── Booking Module Types ─────────────────────────────────────────────────────────

export type DayOfWeek =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

// ─── Staff Schedule ──────────────────────────────────────────────────────────────
export interface StaffDayHours {
  open: string; // HH:MM (ej: '09:00')
  close: string; // HH:MM (ej: '18:00')
  enabled: boolean;
}

export interface StaffSchedule {
  monday: StaffDayHours;
  tuesday: StaffDayHours;
  wednesday: StaffDayHours;
  thursday: StaffDayHours;
  friday: StaffDayHours;
  saturday: StaffDayHours;
  sunday: StaffDayHours;
  blockedDates: string[]; // ISO date strings (YYYY-MM-DD) — vacaciones, días libres
}

// ─── Staff (Professional/Employee) ──────────────────────────────────────────────
export interface Staff {
  _id: string;
  tenantId: string;
  name: string;
  avatar_url?: string | null;
  bio?: string | null;
  serviceIds: string[]; // Product IDs of type 'service' this staff provides
  schedule: StaffSchedule;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Availability / Time Slots ──────────────────────────────────────────────────
export interface BookingSlot {
  time: string; // HH:MM (ej: '10:30')
  datetime: string; // ISO 8601 (ej: '2026-05-20T10:30:00Z')
  available: boolean;
  orderId?: string | null; // If taken, which order occupies it
}

export interface AvailabilityResponse {
  date: string; // YYYY-MM-DD
  staffId: string;
  serviceDurationMinutes: number;
  slots: BookingSlot[];
}

// ─── DTOs ───────────────────────────────────────────────────────────────────────
export interface CreateStaffDto {
  name: string;
  bio?: string | null;
  avatar_url?: string | null;
  serviceIds: string[]; // Product IDs
  schedule: StaffSchedule;
}

export interface UpdateStaffDto {
  name?: string;
  bio?: string | null;
  avatar_url?: string | null;
  serviceIds?: string[];
  schedule?: StaffSchedule;
  active?: boolean;
}
