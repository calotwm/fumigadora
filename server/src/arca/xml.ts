import { XMLParser } from 'fast-xml-parser';

/** Error talking to ARCA (network, SOAP fault, malformed answer). The message never contains secrets. */
export class ArcaError extends Error {
  constructor(
    message: string,
    /** True when the request may have reached ARCA (timeouts, unreadable answer): the result is unknown. */
    public readonly uncertain = false,
  ) {
    super(message);
  }
}

export function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

const parser = new XMLParser({
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

export type XmlNode = Record<string, unknown>;

export function parseXml(xml: string): XmlNode {
  try {
    return parser.parse(xml) as XmlNode;
  } catch {
    throw new ArcaError('Respuesta de ARCA ilegible', true);
  }
}

/** Walks `a.b.c`; returns undefined when any step is missing. */
export function dig(node: unknown, path: string): unknown {
  let cur: unknown = node;
  for (const key of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as XmlNode)[key];
  }
  return cur;
}

export function toArray<T>(value: T | T[] | undefined | null | ''): T[] {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

export function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** Throws the SOAP fault message when the body is a fault. */
export function throwOnFault(doc: XmlNode): void {
  const fault = dig(doc, 'Envelope.Body.Fault');
  if (fault) {
    const msg = text(dig(fault, 'faultstring')) ?? text(dig(fault, 'Reason.Text')) ?? 'SOAP fault';
    throw new ArcaError(`ARCA respondió con un error: ${msg}`);
  }
}
