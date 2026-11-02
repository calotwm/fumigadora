import { lazy, Suspense, type ComponentProps } from 'react';
import type { StopsMap as StopsMapComponent } from './StopsMap';

export type { MapStop } from './StopsMap';

// Leaflet is ~150 kB: load it only when a map is actually shown.
const StopsMap = lazy(() => import('./StopsMap').then((m) => ({ default: m.StopsMap })));

export function LazyStopsMap(props: ComponentProps<typeof StopsMapComponent>) {
  return (
    <Suspense fallback={<div className={`w-full border border-ink bg-paper-2 ${props.className ?? 'h-[360px] md:h-[460px]'}`} />}>
      <StopsMap {...props} />
    </Suspense>
  );
}
