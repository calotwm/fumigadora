import plagamixBlack from '../../assets/plagamix-black.png';
import { QrCode } from './QrCode';

export type Paper = 'A5' | 'A4';

export const PAPER_MM: Record<Paper, { width: number; height: number }> = {
  A5: { width: 148, height: 210 },
  A4: { width: 210, height: 297 },
};

/** `https://app.example.com/c/abc` -> `app.example.com/c/abc` (the short text printed under the QR). */
export const shortUrl = (url: string) => url.replace(/^https?:\/\//, '');

/**
 * One printable placard: yellow band with the logo, the client name, the QR of its public link and the short URL.
 * Everything is sized in `cqw` (percent of the sheet width), so the same markup fills an A5 or an A4 page.
 */
export function Placard({ name, url, paper }: { name: string; url: string; paper: Paper }) {
  const { width, height } = PAPER_MM[paper];
  return (
    <article
      className="placard relative flex flex-col overflow-hidden bg-paper text-ink"
      style={{ width: `${width}mm`, height: `${height}mm`, containerType: 'size' }}
      aria-label={`Cartel de ${name}`}
    >
      <header className="shrink-0 bg-yellow" style={{ padding: '5cqw 8cqw' }}>
        <img src={plagamixBlack} alt="Plagamix" width={374} height={100} style={{ width: '42cqw', height: 'auto' }} />
      </header>
      <div style={{ height: '1.6cqw' }} className="shrink-0 bg-ink" />
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center text-center" style={{ padding: '3cqw 8cqw', gap: '3.5cqw' }}>
        <h1
          className="font-extrabold tracking-tight"
          style={{ fontSize: '7cqw', lineHeight: 1.08, overflowWrap: 'anywhere', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
        >
          {name}
        </h1>
        <p className="font-semibold uppercase" style={{ fontSize: '3.2cqw', letterSpacing: '0.08em' }}>
          Escaneá para ver la próxima visita
        </p>
        <div className="shrink-0" style={{ width: '50cqw', height: '50cqw' }}>
          <QrCode value={url} label={`Código QR de ${name}`} className="block h-full w-full" />
        </div>
        <p className="font-bold" style={{ fontSize: '3.4cqw', overflowWrap: 'anywhere' }}>
          {shortUrl(url)}
        </p>
      </div>
      <footer className="shrink-0 bg-ink text-paper" style={{ padding: '3cqw 8cqw', fontSize: '2.8cqw' }}>
        Próxima visita y vigencia de la oblea, siempre actualizadas.
      </footer>
    </article>
  );
}
