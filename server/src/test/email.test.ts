import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config.js';
import { createMailProvider, type FetchLike } from '../mail/provider.js';
import { debtReminderEmail, serviceNoticeEmail } from '../mail/templates.js';
import { makeTestApp, type TestApp } from './helpers.js';

describe('mail provider selection', () => {
  it('is simulated without credentials and real with both variables', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(createMailProvider(loadConfig({}).mail).mode).toBe('simulated');
    expect(createMailProvider(loadConfig({ RESEND_API_KEY: 're_x' }).mail).mode).toBe('simulated');
    const real = createMailProvider(loadConfig({ RESEND_API_KEY: 're_x', MAIL_FROM: 'Plagamix <avisos@example.com>', MAIL_REPLY_TO: 'lucas@example.com' }).mail);
    expect(real).toMatchObject({ mode: 'resend', from: 'Plagamix <avisos@example.com>' });
    warn.mockRestore();
  });

  it('posts to the Resend API with bearer auth, reply-to and tag', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ id: 'abc123' }) }));
    const provider = createMailProvider({ resendApiKey: 're_secret', from: 'Plagamix <avisos@example.com>', replyTo: 'lucas@example.com' }, fetchMock);
    const result = await provider.sendEmail({ to: 'a@example.com', subject: 'Hola', html: '<p>x</p>', text: 'x', tag: 'service_notice' });
    expect(result.providerId).toBe('abc123');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers.authorization).toBe('Bearer re_secret');
    expect(JSON.parse(init.body)).toMatchObject({
      from: 'Plagamix <avisos@example.com>',
      to: ['a@example.com'],
      reply_to: 'lucas@example.com',
      tags: [{ name: 'kind', value: 'service_notice' }],
    });
  });

  it('turns a non-2xx answer into an error', async () => {
    const fetchMock: FetchLike = async () => ({ ok: false, status: 422, text: async () => JSON.stringify({ message: 'invalid from' }) });
    const provider = createMailProvider({ resendApiKey: 'k', from: 'f@example.com', replyTo: undefined }, fetchMock);
    await expect(provider.sendEmail({ to: 'a@example.com', subject: 's', html: 'h', text: 't', tag: 'test' })).rejects.toThrow(/422.*invalid from/);
  });
});

describe('templates', () => {
  it('escape user text and carry brand and footer', () => {
    const mail = serviceNoticeEmail({ clientName: '<b>Ana</b>', serviceName: 'Desinsectación', date: '2025-06-20', time: '09:30:00', address: 'Calle 1', assigneeName: null });
    expect(mail.html).toContain('Plagamix');
    expect(mail.html).toContain('#f5c400');
    expect(mail.html).toContain('Este es un aviso automático.');
    expect(mail.html).not.toContain('<b>Ana</b>');
    expect(mail.text).toContain('viernes 20 de junio de 2025');
    expect(mail.text).toContain('09:30 hs');
  });

  it('lists overdue invoices with the total and the polite disclaimer', () => {
    const mail = debtReminderEmail({ clientName: 'Ana', invoices: [{ number: '2025-0001', dueOn: '2025-05-01', balanceCents: 100_000 }], totalCents: 100_000 });
    expect(mail.text).toContain('2025-0001');
    expect(mail.text).toContain('desestime este mensaje');
  });
});

describe('email and settings API', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await makeTestApp();
  });
  afterAll(() => t.close());

  it('reports simulated mode', async () => {
    const res = await t.get('/api/email/status');
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('simulated');
  });

  it('logs a test send and exposes it through the log with its html', async () => {
    const bad = await t.post('/api/email/test', { to: 'no-es-un-mail' });
    expect(bad.status).toBe(400);
    const res = await t.post('/api/email/test', { to: 'Lucas@Example.com' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ kind: 'test', to: 'lucas@example.com', status: 'simulated' });
    expect(res.body.html).toBeUndefined();
    const list = await t.get('/api/email/log?kind=test');
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].id).toBe(res.body.id);
    expect((await t.get('/api/email/log?kind=debt_reminder')).body.total).toBe(0);
    const detail = await t.get(`/api/email/log/${res.body.id}`);
    expect(detail.body.html).toContain('Plagamix');
    expect((await t.get('/api/email/log/9999')).status).toBe(404);
  });

  it('round-trips settings with defaults and validates them', async () => {
    const initial = await t.get('/api/settings');
    expect(initial.body).toEqual({
      debtRemindersEnabled: false,
      debtReminderEveryDays: 15,
      debtReminderMinDaysOverdue: 10,
      noticeMode: 'on_approve',
      noticeDaysBefore: 7,
      arcaAutoEmit: false,
      companyAddress: null,
      companyLatitude: null,
      companyLongitude: null,
    });
    const put = await t.call('PUT', '/api/settings', { debtRemindersEnabled: true, debtReminderEveryDays: 20, noticeMode: 'days_before' });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ debtRemindersEnabled: true, debtReminderEveryDays: 20, debtReminderMinDaysOverdue: 10, noticeMode: 'days_before' });
    expect((await t.get('/api/settings')).body).toEqual(put.body);
    expect((await t.call('PUT', '/api/settings', { debtReminderEveryDays: 0 })).status).toBe(400);
  });
});
