import { validateMrz } from './mrzValidation';

export type ReviewedIdentity = { cedula: string; nombre: string };
export function mrzIdentityCandidate(raw: string) {
  const result = validateMrz(raw);
  if (!result.valid || !result.cedula) return null;
  return { cedula: result.cedula,
    nombre: [result.names, result.surname?.join(' ')].filter(Boolean).join(' '),
    requiresReview: true as const };
}
export function validateReviewedIdentity(input: ReviewedIdentity) {
  const cedula = input.cedula.trim();
  const nombre = input.nombre.trim().replace(/\s+/g, ' ');
  if (!/^[1-9]\d{4,9}$/.test(cedula)) return { valid: false as const, error: 'Escribe la cédula de 5 a 10 dígitos, sin puntos ni espacios.' };
  if (nombre.length < 2 || nombre.length > 160 || !/^[A-Za-zÀ-ÖØ-öø-ÿ .’'\-]+$/.test(nombre)
    || (nombre.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/g)?.length || 0) < 2)
    return { valid: false as const, error: 'Revisa el nombre completo tal como aparece en la cédula.' };
  return { valid: true as const, identity: { cedula, nombre } };
}
export function sameIdentityName(a: string, b: string) {
  const tokens = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
  return !!tokens(a) && tokens(a) === tokens(b);
}
