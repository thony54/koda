import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Sparkles, Instagram } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, Button, Input, Select } from '@/components/ui';
import { buildProspectFromInput } from '@/lib/data/build';
import { addProspects } from '@/lib/data/prospects';
import { ScoreBadge } from '@/components/prospects/ScoreBadge';
import { useUIStore } from '@/store/uiStore';
import type { Prospect } from '@/types/domain';

const PLATAFORMAS = ['Instagram', 'TikTok', 'YouTube', 'Facebook'];
const CIUDADES = ['Ibarra', 'Otavalo', 'Quito', 'Guayaquil', 'Cuenca'];

export default function Curation() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useUIStore((s) => s.toast);

  const [usuario, setUsuario] = useState('');
  const [nombre, setNombre] = useState('');
  const [plataforma, setPlataforma] = useState('Instagram');
  const [nicho, setNicho] = useState('');
  const [ciudad, setCiudad] = useState('Quito');
  const [alcance, setAlcance] = useState('');
  const [contacto, setContacto] = useState('');
  const [saving, setSaving] = useState(false);
  const [ultimo, setUltimo] = useState<Prospect | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!usuario.trim()) { toast('El @usuario es obligatorio.', 'error'); return; }
    setSaving(true);

    const reviews = alcance ? Math.round(Number(alcance.replace(/\D/g, '')) / 1000) : 0;
    const isWhatsapp = /^\+?\d[\d\s]{6,}$/.test(contacto.trim());
    const p = buildProspectFromInput({
      nombre: nombre.trim() || usuario.trim(),
      tipo: 'creador_contenido',
      categoria: nicho.trim() || 'creador de contenido',
      ciudad,
      instagram: plataforma === 'Instagram' ? usuario.replace(/^@/, '') : undefined,
      tiktok: plataforma === 'TikTok' ? usuario.replace(/^@/, '') : undefined,
      whatsapp: isWhatsapp ? contacto.trim() : undefined,
      email: !isWhatsapp && contacto.includes('@') ? contacto.trim() : undefined,
      usa_linktree: true,
      ig_activo: true,
      reviews_count: reviews,
      rating: 4.7,
      source_nombre: 'Curaduría manual',
    });

    await addProspects([p]);
    qc.invalidateQueries({ queryKey: ['prospects'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    setSaving(false);
    setUltimo(p);
    toast(`Creador @${usuario.replace(/^@/, '')} agregado`, 'success');
    setUsuario(''); setNombre(''); setNicho(''); setAlcance(''); setContacto('');
  }

  return (
    <div>
      <PageHeader
        title="Curaduría de creadores"
        description="Alta manual de creadores de contenido. Nada de scraping de redes: KODA guarda solo lo que el analista escribe."
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="@usuario *"
                value={usuario}
                onChange={(e) => setUsuario(e.target.value)}
                placeholder="@marcela.reposteria"
                icon={<Instagram className="h-4 w-4" />}
                required
              />
              <Input
                label="Nombre visible"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Marcela Repostería"
              />
              <Select label="Plataforma" value={plataforma} onChange={(e) => setPlataforma(e.target.value)}>
                {PLATAFORMAS.map((p) => <option key={p} value={p}>{p}</option>)}
              </Select>
              <Select label="Ciudad" value={ciudad} onChange={(e) => setCiudad(e.target.value)}>
                {CIUDADES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
              <Input
                label="Nicho"
                value={nicho}
                onChange={(e) => setNicho(e.target.value)}
                placeholder="gastronomía, moda, fitness…"
              />
              <Input
                label="Alcance aproximado (seguidores)"
                value={alcance}
                onChange={(e) => setAlcance(e.target.value)}
                placeholder="12000"
                inputMode="numeric"
              />
              <Input
                label="Contacto (WhatsApp o email)"
                value={contacto}
                onChange={(e) => setContacto(e.target.value)}
                placeholder="0991234567 o hola@correo.com"
                className="sm:col-span-2"
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit" loading={saving}>
                <Sparkles className="h-4 w-4" /> Agregar creador
              </Button>
            </div>
          </form>
        </Card>

        <Card>
          <h2 className="mb-2 font-heading text-lg text-ink-primary">Cómo funciona</h2>
          <p className="text-sm text-ink-secondary">
            Para creadores no automatizamos redes (viola sus términos). Un analista
            pega el @usuario y KODA calcula su score con las mismas reglas.
          </p>
          {ultimo && (
            <div className="mt-4 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3">
              <p className="text-sm font-medium text-ink-primary">Último agregado</p>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-sm text-ink-secondary">{ultimo.nombre}</span>
                <ScoreBadge score={ultimo.score} showLabel />
              </div>
              <button
                onClick={() => navigate(`/prospectos/${ultimo.id}`)}
                className="mt-2 text-xs text-[var(--primary-orange)] hover:underline"
              >
                Ver ficha →
              </button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
