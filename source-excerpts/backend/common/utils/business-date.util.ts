/**
 * Calcula la "fecha de negocio" para una marca de tiempo dada.
 *
 * Un negocio nocturno (bar, club) puede operar más allá de la medianoche;
 * las órdenes de madrugada deben contarse como parte del "día anterior".
 *
 * Ejemplo: cutoffHour = 4 → una orden a las 3:00 AM del martes se asigna
 *          al día de negocio del lunes (el turno nocturno del lunes).
 *
 * Con cutoffHour = 0 (default) el comportamiento es idéntico al calendario
 * normal: la fecha cambia a las 00:00 de la TZ del tenant.
 *
 * @param now        Timestamp de la orden
 * @param cutoffHour Hora de corte local (0–6). Valor 0 = sin ajuste nocturno.
 * @param timezone   IANA timezone del tenant (ej. 'America/Caracas')
 * @returns          Fecha de negocio en formato 'YYYY-MM-DD'
 */
export function getBusinessDate(
  now: Date,
  cutoffHour: number,
  timezone: string,
): string {
  // Descomponer el instante en partes de fecha/hora dentro de la TZ del tenant.
  // Usamos Intl para evitar dependencias externas y ser DST-safe.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const year = Number(parts.find((p) => p.type === "year")!.value);
  const month = Number(parts.find((p) => p.type === "month")!.value);
  const day = Number(parts.find((p) => p.type === "day")!.value);
  const hour = Number(parts.find((p) => p.type === "hour")!.value);

  // Si la hora local es anterior al corte → la orden pertenece al día anterior
  // (turno nocturno que empezó "ayer").
  if (cutoffHour > 0 && hour < cutoffHour) {
    // Construimos un Date UTC puro para restar un día sin ambigüedad de TZ.
    const d = new Date(Date.UTC(year, month - 1, day - 1));
    return d.toISOString().slice(0, 10); // 'YYYY-MM-DD'
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
