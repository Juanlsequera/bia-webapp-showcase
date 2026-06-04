/** Arqueo de caja — conteo físico del cierre diario. */
export interface CajaArqueo {
  _id: string;
  date: string;
  efectivo_fisico: number | null;
  debito_fisico: number | null;
  debito_receipt_url: string | null;
  debito_receipt_public_id: string | null;
  notas: string | null;
  cerrado_por: string;
  /** true cuando el admin ejecutó "Cerrar caja del día" formalmente. */
  is_closed: boolean;
  /** Timestamp ISO del cierre formal. null si aún no se cerró. */
  closed_at: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SaveArqueoDto {
  date: string;
  efectivo_fisico?: number;
  debito_fisico?: number;
  debito_receipt_url?: string;
  debito_receipt_public_id?: string;
  notas?: string;
}
