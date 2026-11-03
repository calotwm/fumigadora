import { ticketTotalCents } from './ticketAmount';

/**
 * Reads a ticket photo on the device with Tesseract (Spanish) and returns its total in cents, or null.
 * Tesseract and its language data (a few MB) are loaded on first use only, so the employee app stays light.
 */
export async function readTicketTotal(photo: File): Promise<number | null> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('spa');
  try {
    const { data } = await worker.recognize(photo);
    return ticketTotalCents(data.text);
  } finally {
    await worker.terminate();
  }
}
