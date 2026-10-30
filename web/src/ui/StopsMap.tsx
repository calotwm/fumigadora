import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { GeoPoint } from '@fumigadora/shared';

export interface MapStop {
  key: string | number;
  latitude: number;
  longitude: number;
  color: string;
  /** Text inside the pin (the stop number), or empty for a plain dot. */
  label: string;
  title: string;
  /** Plain-text lines shown when the pin is tapped. */
  details: string[];
}

const BASE_ICON = L.divIcon({
  className: '',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
  html: '<span style="display:block;width:22px;height:22px;background:#f5c400;border:2px solid #0a0a0a"></span>',
});

function pin(color: string, label: string): L.DivIcon {
  return L.divIcon({
    className: '',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    html: `<span style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:${color};color:#fff;border:2px solid #fff;box-shadow:0 0 0 1px #0a0a0a;font:700 12px/1 sans-serif">${escapeHtml(label)}</span>`,
  });
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * OpenStreetMap with one pin per stop and the company base as a yellow square. With `path`, a line joins the base
 * and the stops in the given order. The view fits whatever is shown.
 */
export function StopsMap({
  stops,
  base,
  path = null,
  className = 'h-[360px] md:h-[460px]',
}: {
  stops: MapStop[];
  base: GeoPoint | null;
  /** Line colour when the stops are a trip in order; null for no line. */
  path?: string | null;
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!container.current) return;
    const instance = L.map(container.current, { scrollWheelZoom: false }).setView([-34.6037, -58.3816], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(instance);
    layer.current = L.layerGroup().addTo(instance);
    map.current = instance;
    // Leaflet measures its box once; re-measure whenever the layout changes it so tiles cover the whole map.
    const observer = new ResizeObserver(() => instance.invalidateSize());
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      instance.remove();
      map.current = null;
      layer.current = null;
    };
  }, []);

  useEffect(() => {
    const instance = map.current;
    const group = layer.current;
    if (!instance || !group) return;
    instance.invalidateSize();
    group.clearLayers();
    const points: L.LatLngExpression[] = [];
    if (base) {
      L.marker([base.latitude, base.longitude], { icon: BASE_ICON, title: 'Base' }).bindTooltip('Base').addTo(group);
      if (path) points.push([base.latitude, base.longitude]);
    }
    for (const stop of stops) {
      const latLng: L.LatLngExpression = [stop.latitude, stop.longitude];
      points.push(latLng);
      L.marker(latLng, { icon: pin(stop.color, stop.label), title: stop.title })
        .bindPopup(`<strong>${escapeHtml(stop.title)}</strong>${stop.details.map((d) => `<br>${escapeHtml(d)}`).join('')}`)
        .addTo(group);
    }
    if (path && points.length > 1) L.polyline(points, { color: path, weight: 3, opacity: 0.8 }).addTo(group);
    if (points.length > 0) instance.fitBounds(L.latLngBounds(points), { padding: [32, 32], maxZoom: 15 });
    else if (base) instance.setView([base.latitude, base.longitude], 12);
  }, [stops, base, path]);

  return <div ref={container} className={`relative z-0 w-full border border-ink ${className}`} />;
}
