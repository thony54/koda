import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, FileText, AlertTriangle, CheckCircle2, Download } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, Button, Badge, Table, THead, TBody, TR, TH, TD } from '@/components/ui';
import { parseCSV, guessMapping, IMPORT_FIELDS, type ImportFieldKey } from '@/lib/csv';
import { buildProspectFromInput, type ProspectInput } from '@/lib/data/build';
import { addProspects, getDedupeKeys } from '@/lib/data/prospects';
import { ScoreBadge } from '@/components/prospects/ScoreBadge';
import { slug } from '@/lib/format';
import { useUIStore } from '@/store/uiStore';

const TEMPLATE = `nombre,categoria,ciudad,telefono,whatsapp,email,website,instagram
Panadería La Espiga,panadería,Ibarra,062951000,0991112233,,,
Barbería Estilo,barbería,Quito,,0987776655,,,estilo.barber`;

export default function Import() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useUIStore((s) => s.toast);
  const fileRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<ImportFieldKey, string>>({} as Record<ImportFieldKey, string>);
  const [importing, setImporting] = useState(false);

  function onFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const { headers, rows } = parseCSV(String(reader.result));
      if (!headers.length) { toast('El CSV está vacío o no se pudo leer.', 'error'); return; }
      setFileName(file.name);
      setHeaders(headers);
      setRows(rows);
      setMapping(guessMapping(headers));
    };
    reader.readAsText(file);
  }

  const inputs: ProspectInput[] = useMemo(() => {
    if (!mapping.nombre) return [];
    return rows
      .map((r) => ({
        nombre: r[mapping.nombre] ?? '',
        categoria: mapping.categoria ? r[mapping.categoria] : undefined,
        ciudad: mapping.ciudad ? r[mapping.ciudad] : undefined,
        telefono: mapping.telefono ? r[mapping.telefono] : undefined,
        whatsapp: mapping.whatsapp ? r[mapping.whatsapp] : undefined,
        email: mapping.email ? r[mapping.email] : undefined,
        website: mapping.website ? r[mapping.website] : undefined,
        instagram: mapping.instagram ? r[mapping.instagram] : undefined,
      }))
      .filter((i) => i.nombre.trim() !== '');
  }, [rows, mapping]);

  const { data: dedupeKeys } = useQuery({ queryKey: ['dedupe-keys'], queryFn: getDedupeKeys });

  const dupes = useMemo(() => {
    const existing = dedupeKeys ?? new Set<string>();
    const seen = new Set<string>();
    return inputs.map((i) => {
      const key = `${slug(i.nombre)}|${slug(i.ciudad ?? '')}`;
      const dup = existing.has(key) || seen.has(key);
      seen.add(key);
      return dup;
    });
  }, [inputs, dedupeKeys]);
  const dupCount = dupes.filter(Boolean).length;
  const nuevos = inputs.length - dupCount;

  const preview = useMemo(() => inputs.slice(0, 8).map((i) => buildProspectFromInput(i)), [inputs]);

  async function confirmImport() {
    setImporting(true);
    const toAdd = inputs.filter((_, i) => !dupes[i]).map((i) => buildProspectFromInput({ ...i, ig_activo: Boolean(i.instagram) }));
    await addProspects(toAdd);
    qc.invalidateQueries({ queryKey: ['prospects'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    qc.invalidateQueries({ queryKey: ['prospect-facets'] });
    qc.invalidateQueries({ queryKey: ['dedupe-keys'] });
    setImporting(false);
    toast(`${toAdd.length} prospectos importados (${dupCount} duplicados omitidos)`, 'success');
    navigate('/prospectos');
  }

  function downloadTemplate() {
    const blob = new Blob([`﻿${TEMPLATE}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'plantilla-koda.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <PageHeader
        title="Importar"
        description="Carga de prospectos desde CSV (ferias, cámaras, listas de aliados)."
        actions={
          <Button variant="ghost" size="sm" onClick={downloadTemplate}>
            <Download className="h-4 w-4" /> Plantilla CSV
          </Button>
        }
      />

      {headers.length === 0 ? (
        <Card>
          <div
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
            onDragOver={(e) => e.preventDefault()}
            className="grid place-items-center gap-3 rounded-md border-2 border-dashed border-line py-16 text-center"
          >
            <Upload className="h-8 w-8 text-ink-muted" />
            <div>
              <p className="text-ink-primary">Arrastra un CSV aquí o</p>
              <button onClick={() => fileRef.current?.click()} className="text-[var(--primary-orange)] hover:underline">
                selecciona un archivo
              </button>
            </div>
            <p className="text-xs text-ink-muted">Debe tener al menos una columna con el nombre del negocio.</p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
            />
          </div>
        </Card>
      ) : (
        <div className="space-y-5">
          {/* Resumen archivo */}
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="primary"><FileText className="mr-1 h-3 w-3" />{fileName}</Badge>
            <span className="text-sm text-ink-secondary">{inputs.length} filas con nombre</span>
            <button onClick={() => { setHeaders([]); setRows([]); setFileName(''); }} className="text-sm text-ink-muted hover:text-ink-primary">
              Cambiar archivo
            </button>
          </div>

          {/* Mapeo de columnas */}
          <Card>
            <h2 className="mb-3 font-heading text-lg text-ink-primary">Mapeo de columnas</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {IMPORT_FIELDS.map((f) => (
                <label key={f.key} className="space-y-1">
                  <span className="text-xs font-medium text-ink-secondary">
                    {f.label} {f.required && <span className="text-[var(--primary-orange)]">*</span>}
                  </span>
                  <select
                    value={mapping[f.key] ?? ''}
                    onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}
                    className="glass-input w-full rounded-md px-2 py-1.5 text-sm text-ink-primary outline-none"
                  >
                    <option value="">— ninguna —</option>
                    {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </label>
              ))}
            </div>
            {!mapping.nombre && (
              <p className="mt-3 flex items-center gap-1.5 text-sm text-amber-400">
                <AlertTriangle className="h-4 w-4" /> Elige qué columna es el nombre para continuar.
              </p>
            )}
          </Card>

          {/* Resumen dedupe */}
          {mapping.nombre && (
            <div className="grid grid-cols-3 gap-4">
              <Card><p className="text-sm text-ink-secondary">Filas</p><p className="font-heading text-2xl text-ink-primary">{inputs.length}</p></Card>
              <Card><p className="text-sm text-ink-secondary">Nuevos</p><p className="font-heading text-2xl text-emerald-400">{nuevos}</p></Card>
              <Card><p className="text-sm text-ink-secondary">Duplicados</p><p className="font-heading text-2xl text-amber-400">{dupCount}</p></Card>
            </div>
          )}

          {/* Vista previa */}
          {mapping.nombre && preview.length > 0 && (
            <Card padding="none">
              <div className="border-b border-line px-5 py-3">
                <h2 className="font-heading text-lg text-ink-primary">Vista previa (primeras 8)</h2>
              </div>
              <Table>
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>Nombre</TH><TH>Ciudad</TH><TH>Categoría</TH><TH>Score</TH><TH>Estado</TH>
                  </TR>
                </THead>
                <TBody>
                  {preview.map((p, i) => (
                    <TR key={p.id}>
                      <TD className="font-medium text-ink-primary">{p.nombre}</TD>
                      <TD className="text-ink-secondary">{p.ciudad ?? '—'}</TD>
                      <TD className="text-ink-secondary capitalize">{p.categoria ?? '—'}</TD>
                      <TD><ScoreBadge score={p.score} /></TD>
                      <TD>
                        {dupes[i]
                          ? <Badge variant="warning">Duplicado</Badge>
                          : <Badge variant="success"><CheckCircle2 className="mr-1 h-3 w-3" />Nuevo</Badge>}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          )}

          {/* Confirmar */}
          {mapping.nombre && (
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => { setHeaders([]); setRows([]); }}>Cancelar</Button>
              <Button onClick={confirmImport} loading={importing} disabled={nuevos === 0}>
                Importar {nuevos} prospecto(s)
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
