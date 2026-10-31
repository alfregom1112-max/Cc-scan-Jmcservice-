export type PendingScan = {
  cedula: string;
  evento_id: string;
  device_id: string;
  timestamp: number;
  nonce: string;
  nombre: string;
  sede: string;
  municipio: string;
  cargo: string;
  idempotency_key: string;
  operator_id?: string;
  attempts: number;
};

export type CachedHistoryScan = {
  id: string;
  cedula: string;
  nombre?: string;
  created_at: string;
  operator_id?: string;
};
