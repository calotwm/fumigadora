import { formatMoney, longDateEs, shortDateEs, type IsoDate } from '@fumigadora/shared';

export const COMPANY_NAME = 'Plagamix';
const FOOTER = 'Este es un aviso automático.';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

type Block = { type: 'p'; text: string } | { type: 'facts'; rows: [string, string][] } | { type: 'table'; head: string[]; rows: string[][]; total?: [string, string] };

/** Branded, table-based layout with inline styles (works in mail clients) plus a plain-text alternative. */
function layout(subject: string, heading: string, blocks: Block[]): RenderedEmail {
  const body = blocks
    .map((block) => {
      if (block.type === 'p') {
        return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#1a1a1a;">${escapeHtml(block.text)}</p>`;
      }
      if (block.type === 'facts') {
        const rows = block.rows
          .map(
            ([label, value]) =>
              `<tr><td style="padding:8px 12px;border-bottom:1px solid #e6e6e0;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#6b6b66;width:130px;vertical-align:top;">${escapeHtml(label)}</td><td style="padding:8px 12px;border-bottom:1px solid #e6e6e0;font-size:15px;font-weight:700;color:#111111;">${escapeHtml(value)}</td></tr>`,
          )
          .join('');
        return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border-top:2px solid #111111;">${rows}</table>`;
      }
      const head = block.head
        .map(
          (h, i) =>
            `<th align="${i === 0 ? 'left' : 'right'}" style="padding:8px 10px;border-bottom:2px solid #111111;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#6b6b66;">${escapeHtml(h)}</th>`,
        )
        .join('');
      const rows = block.rows
        .map(
          (row) =>
            `<tr>${row
              .map(
                (cell, i) =>
                  `<td align="${i === 0 ? 'left' : 'right'}" style="padding:8px 10px;border-bottom:1px solid #e6e6e0;font-size:14px;color:#1a1a1a;">${escapeHtml(cell)}</td>`,
              )
              .join('')}</tr>`,
        )
        .join('');
      const total = block.total
        ? `<tr><td colspan="${block.head.length - 1}" align="right" style="padding:10px;font-size:14px;font-weight:700;color:#111111;">${escapeHtml(block.total[0])}</td><td align="right" style="padding:10px;font-size:16px;font-weight:800;color:#111111;">${escapeHtml(block.total[1])}</td></tr>`
        : '';
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border-collapse:collapse;"><tr>${head}</tr>${rows}${total}</table>`;
    })
    .join('\n');

  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f4ef;font-family:Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4ef;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;">
<tr><td style="background:#111111;padding:18px 24px;font-size:22px;font-weight:800;letter-spacing:.04em;color:#ffffff;">${COMPANY_NAME}</td></tr>
<tr><td style="background:#f5c400;height:4px;line-height:4px;font-size:0;">&nbsp;</td></tr>
<tr><td style="padding:28px 24px 8px;">
<h1 style="margin:0 0 20px;font-size:20px;line-height:1.3;color:#111111;">${escapeHtml(heading)}</h1>
${body}
</td></tr>
<tr><td style="padding:16px 24px 24px;border-top:1px solid #e6e6e0;font-size:12px;color:#6b6b66;">${FOOTER}</td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    COMPANY_NAME,
    '='.repeat(COMPANY_NAME.length),
    '',
    heading,
    '',
    ...blocks.map((block) => {
      if (block.type === 'p') return `${block.text}\n`;
      if (block.type === 'facts') return `${block.rows.map(([l, v]) => `${l}: ${v}`).join('\n')}\n`;
      return `${[block.head.join(' | '), ...block.rows.map((r) => r.join(' | ')), ...(block.total ? [`${block.total[0]} ${block.total[1]}`] : [])].join('\n')}\n`;
    }),
    '--',
    FOOTER,
  ].join('\n');

  return { subject, html, text };
}

export interface ServiceNoticeInput {
  clientName: string;
  serviceName: string;
  date: IsoDate;
  time: string | null;
  address: string | null;
  assigneeName: string | null;
}

export function serviceNoticeEmail(input: ServiceNoticeInput): RenderedEmail {
  const rows: [string, string][] = [
    ['Servicio', input.serviceName],
    ['Fecha', longDateEs(input.date)],
  ];
  if (input.time) rows.push(['Horario', `${input.time.slice(0, 5)} hs`]);
  if (input.address) rows.push(['Domicilio', input.address]);
  if (input.assigneeName) rows.push(['Técnico', input.assigneeName]);
  return layout(`Aviso de servicio programado: ${shortDateEs(input.date)}`, 'Su próximo servicio está programado', [
    { type: 'p', text: `Estimado/a ${input.clientName}:` },
    { type: 'p', text: 'Le informamos que hemos programado su próximo servicio con los siguientes datos.' },
    { type: 'facts', rows },
    { type: 'p', text: 'Por favor, procure que el lugar esté accesible. Si necesita reprogramar la visita, responda a este mensaje o comuníquese con nosotros.' },
    { type: 'p', text: 'Muchas gracias.' },
  ]);
}

export interface DebtReminderInput {
  clientName: string;
  invoices: { number: string; dueOn: IsoDate; balanceCents: number }[];
  totalCents: number;
}

export function debtReminderEmail(input: DebtReminderInput): RenderedEmail {
  return layout('Recordatorio de saldo pendiente', 'Recordatorio de saldo pendiente', [
    { type: 'p', text: `Estimado/a ${input.clientName}:` },
    { type: 'p', text: 'Le recordamos que, según nuestros registros, las siguientes facturas se encuentran vencidas y con saldo pendiente.' },
    {
      type: 'table',
      head: ['Factura', 'Vencimiento', 'Saldo'],
      rows: input.invoices.map((i) => [i.number, shortDateEs(i.dueOn), formatMoney(i.balanceCents)]),
      total: ['Total adeudado', formatMoney(input.totalCents)],
    },
    { type: 'p', text: 'Le agradeceremos regularizar el pago a la brevedad. Si necesita los datos para realizar la transferencia o desea coordinar otra forma de pago, responda a este mensaje.' },
    { type: 'p', text: 'Si ya realizó el pago, desestime este mensaje.' },
    { type: 'p', text: 'Muchas gracias.' },
  ]);
}

export function testEmail(): RenderedEmail {
  return layout('Mail de prueba', 'Mail de prueba', [
    { type: 'p', text: 'Este es un mensaje de prueba enviado desde el sistema.' },
    { type: 'p', text: 'Si lo recibió, el envío de avisos automáticos está funcionando correctamente.' },
  ]);
}
