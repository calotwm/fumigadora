import { money } from '../../lib/format';
import type { Invoice } from '../../lib/types';

/** The lines of an invoice (service plus extras). A single line reads as the plain description. */
export function InvoiceLines({ invoice }: { invoice: Pick<Invoice, 'items'> }) {
  return (
    <ul className="text-xs text-muted">
      {invoice.items.map((item, index) => (
        <li key={index} className="flex justify-between gap-2">
          <span className="truncate">
            {item.quantity > 1 ? `${item.quantity} × ` : ''}
            {item.description}
          </span>
          {invoice.items.length > 1 ? <span className="num shrink-0">{money(item.amountCents)}</span> : null}
        </li>
      ))}
    </ul>
  );
}
