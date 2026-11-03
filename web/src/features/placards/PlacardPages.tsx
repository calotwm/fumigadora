import { useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { Printer } from 'lucide-react';
import { errorMessage } from '../../lib/api';
import { useClient, usePlacards, usePublicLink } from '../../lib/queries';
import { Button } from '../../ui/Button';
import { EmptyState, ErrorNote, Loading } from '../../ui/display';
import { Chips } from '../../ui/form';
import { PAPER_MM, Placard, type Paper } from './Placard';

const PAPERS: { value: Paper; label: string }[] = [
  { value: 'A5', label: 'A5' },
  { value: 'A4', label: 'A4' },
];

/** Print rules shared by both pages: the sheet size, no margins, one placard per page and exact colours. */
function PrintStyles({ paper }: { paper: Paper }) {
  const { width, height } = PAPER_MM[paper];
  return (
    <style>{`
      @page { size: ${width}mm ${height}mm; margin: 0; }
      .placard { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      @media print {
        html, body { background: #fff !important; background-image: none !important; }
        .placard-sheet { padding: 0 !important; gap: 0 !important; background: #fff !important; }
        .placard { break-after: page; break-inside: avoid; box-shadow: none !important; }
        .placard:last-child { break-after: auto; }
      }
    `}</style>
  );
}

function Toolbar({ title, note, back, children }: { title: string; note?: string; back: string; children: ReactNode }) {
  return (
    <div className="print:hidden border-b border-ink bg-paper px-4 py-3 md:px-8">
      <div className="mx-auto flex max-w-5xl flex-wrap items-end justify-between gap-4">
        <div>
          <Link to={back} className="text-sm font-semibold text-muted hover:text-ink hover:underline">
            ← Volver
          </Link>
          <h1 className="text-xl font-extrabold tracking-tight">{title}</h1>
          {note ? <p className="text-xs text-muted">{note}</p> : null}
        </div>
        <div className="flex flex-wrap items-end gap-4">{children}</div>
      </div>
    </div>
  );
}

function PaperChips({ paper, onChange }: { paper: Paper; onChange: (paper: Paper) => void }) {
  return <Chips label="Papel" value={paper} options={PAPERS} onChange={onChange} />;
}

function Sheets({ children }: { children: ReactNode }) {
  return <div className="placard-sheet flex flex-col items-center gap-8 bg-paper-2 px-4 py-8 print:block">{children}</div>;
}

/** `/clientes/:id/cartel`: the placard of one client, ready to print. */
export function PlacardPage() {
  const id = Number(useParams().id);
  const valid = Number.isInteger(id) && id > 0;
  const client = useClient(valid ? id : null);
  const link = usePublicLink(valid ? id : null);
  const [paper, setPaper] = useState<Paper>('A5');

  if (!valid) return <ErrorNote message="El cliente no existe." />;
  if (client.isLoading || link.isLoading) return <Loading />;
  if (client.error || link.error || !client.data || !link.data) {
    return <ErrorNote message={errorMessage(client.error ?? link.error)} onRetry={() => (client.error ? client.refetch() : link.refetch())} />;
  }
  return (
    <>
      <PrintStyles paper={paper} />
      <Toolbar title="Cartel con QR" note={client.data.name} back={`/clientes/${id}`}>
        <PaperChips paper={paper} onChange={setPaper} />
        <Button icon={<Printer size={16} aria-hidden />} onClick={() => window.print()}>
          Imprimir
        </Button>
      </Toolbar>
      <Sheets>
        <Placard name={client.data.name} url={link.data.url} paper={paper} />
      </Sheets>
    </>
  );
}

/** `/carteles?zona=`: every active client (or one zone) as a placard, one per page. */
export function PlacardsPage() {
  const [params, setParams] = useSearchParams();
  const zone = params.get('zona') ?? '';
  const [paper, setPaper] = useState<Paper>('A5');
  const list = usePlacards(zone);

  function setZone(value: string) {
    setParams(value ? { zona: value } : {}, { replace: true });
  }

  return (
    <>
      <PrintStyles paper={paper} />
      <Toolbar
        title="Carteles con QR"
        note={list.data ? `${list.data.items.length} ${list.data.items.length === 1 ? 'cartel' : 'carteles'}${zone ? ` · ${zone}` : ''}` : undefined}
        back="/clientes"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="placard-zone" className="label-caps">
            Zona
          </label>
          <select
            id="placard-zone"
            value={zone}
            onChange={(e) => setZone(e.target.value)}
            className="block min-h-11 rounded-sm border border-ink bg-paper px-3 text-base"
          >
            <option value="">Todas</option>
            {(list.data?.zones ?? (zone ? [zone] : [])).map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </div>
        <PaperChips paper={paper} onChange={setPaper} />
        <Button icon={<Printer size={16} aria-hidden />} disabled={!list.data || list.data.items.length === 0} onClick={() => window.print()}>
          Imprimir
        </Button>
      </Toolbar>
      {list.isLoading ? (
        <div className="p-6 print:hidden">
          <Loading />
        </div>
      ) : list.error || !list.data ? (
        <div className="p-6 print:hidden">
          <ErrorNote message={errorMessage(list.error)} onRetry={() => list.refetch()} />
        </div>
      ) : list.data.items.length === 0 ? (
        <div className="p-6 print:hidden">
          <EmptyState title="No hay clientes activos en esta zona." />
        </div>
      ) : (
        <Sheets>
          {list.data.items.map((item) => (
            <Placard key={item.id} name={item.name} url={item.url} paper={paper} />
          ))}
        </Sheets>
      )}
    </>
  );
}
