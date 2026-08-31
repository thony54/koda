/**
 * Parser de CSV mínimo pero correcto: respeta comillas dobles, comas dentro de
 * campos entrecomillados, comillas escapadas ("") y saltos de línea CRLF/LF.
 * Suficiente para la importación de listas de ferias/cámaras/aliados.
 */
export interface ParsedCSV {
  headers: string[];
  rows: Record<string, string>[];
}

export function parseCSV(text: string): ParsedCSV {
  const clean = text.replace(/^﻿/, ''); // quita BOM
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      record.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      record.push(field); field = '';
      if (record.some((c) => c.trim() !== '')) records.push(record);
      record = [];
    } else field += ch;
  }
  if (field !== '' || record.length) {
    record.push(field);
    if (record.some((c) => c.trim() !== '')) records.push(record);
  }

  if (records.length === 0) return { headers: [], rows: [] };
  const headers = records[0].map((h) => h.trim());
  const rows = records.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => (obj[h] = (r[idx] ?? '').trim()));
    return obj;
  });
  return { headers, rows };
}

/** Campos de KODA a los que se puede mapear una columna del CSV. */
export const IMPORT_FIELDS = [
  { key: 'nombre', label: 'Nombre', required: true },
  { key: 'categoria', label: 'Categoría / Rubro', required: false },
  { key: 'ciudad', label: 'Ciudad', required: false },
  { key: 'telefono', label: 'Teléfono', required: false },
  { key: 'whatsapp', label: 'WhatsApp', required: false },
  { key: 'email', label: 'Email', required: false },
  { key: 'website', label: 'Sitio web', required: false },
  { key: 'instagram', label: 'Instagram', required: false },
] as const;

export type ImportFieldKey = (typeof IMPORT_FIELDS)[number]['key'];

/** Adivina el mapeo comparando encabezados con nombres/alias conocidos. */
export function guessMapping(headers: string[]): Record<ImportFieldKey, string> {
  const alias: Record<ImportFieldKey, string[]> = {
    nombre: ['nombre', 'name', 'negocio', 'empresa', 'razon social', 'razón social'],
    categoria: ['categoria', 'categoría', 'rubro', 'giro', 'tipo de negocio'],
    ciudad: ['ciudad', 'city', 'canton', 'cantón'],
    telefono: ['telefono', 'teléfono', 'phone', 'tel', 'celular'],
    whatsapp: ['whatsapp', 'wsp', 'wa'],
    email: ['email', 'correo', 'e-mail', 'mail'],
    website: ['website', 'web', 'sitio', 'url', 'pagina', 'página'],
    instagram: ['instagram', 'ig', '@'],
  };
  const norm = (s: string) => s.toLowerCase().trim();
  const result = {} as Record<ImportFieldKey, string>;
  (Object.keys(alias) as ImportFieldKey[]).forEach((key) => {
    const found = headers.find((h) => alias[key].some((a) => norm(h).includes(a)));
    result[key] = found ?? '';
  });
  return result;
}
