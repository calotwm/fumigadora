import { useMemo } from 'react';
import QRCode from 'qrcode';

const QUIET_ZONE = 4;

/** QR code drawn as one SVG path (no innerHTML, scales to any size, crisp when printed). */
export function QrCode({ value, label, className }: { value: string; label: string; className?: string }) {
  const { size, path } = useMemo(() => {
    const { modules } = QRCode.create(value, { errorCorrectionLevel: 'M' });
    let d = '';
    for (let y = 0; y < modules.size; y++) {
      for (let x = 0; x < modules.size; x++) {
        if (modules.data[y * modules.size + x]) d += `M${x} ${y}h1v1h-1z`;
      }
    }
    return { size: modules.size, path: d };
  }, [value]);
  const full = size + QUIET_ZONE * 2;
  return (
    <svg viewBox={`${-QUIET_ZONE} ${-QUIET_ZONE} ${full} ${full}`} shapeRendering="crispEdges" role="img" aria-label={label} className={className}>
      <rect x={-QUIET_ZONE} y={-QUIET_ZONE} width={full} height={full} fill="#ffffff" />
      <path d={path} fill="#0a0a0a" />
    </svg>
  );
}
