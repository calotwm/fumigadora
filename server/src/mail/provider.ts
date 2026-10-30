import nodemailer from 'nodemailer';
import type { MailConfig, SmtpConfig } from '../config.js';

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Short label for provider-side filtering, e.g. the email kind. */
  tag: string;
}

export interface SendResult {
  /** Id assigned by the provider; null when simulated. */
  providerId: string | null;
}

/** Transport adapter: the only place that knows how an email leaves the system. */
export interface MailProvider {
  mode: 'resend' | 'smtp' | 'simulated';
  from: string;
  sendEmail(message: OutgoingEmail): Promise<SendResult>;
}

export const SIMULATED_FROM = 'Plagamix <avisos@plagamix.example>';

/** Logs the email to the console instead of sending it. Used until a provider is configured. */
export function createSimulatedProvider(from: string = SIMULATED_FROM): MailProvider {
  return {
    mode: 'simulated',
    from,
    async sendEmail(message) {
      console.log(`[mail:simulated] to=${message.to} subject="${message.subject}" tag=${message.tag}`);
      return { providerId: null };
    },
  };
}

export type FetchLike = (input: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

/** Resend HTTP API (https://resend.com/docs/api-reference/emails/send-email). */
export function createResendProvider(apiKey: string, from: string, replyTo?: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): MailProvider {
  return {
    mode: 'resend',
    from,
    async sendEmail(message) {
      const response = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
          ...(replyTo ? { reply_to: replyTo } : {}),
          tags: [{ name: 'kind', value: message.tag.replace(/[^A-Za-z0-9_-]/g, '_') }],
        }),
      });
      const raw = await response.text();
      let parsed: { id?: string; message?: string } = {};
      try {
        parsed = raw ? (JSON.parse(raw) as typeof parsed) : {};
      } catch {
        // Non-JSON body: the status code is enough.
      }
      if (!response.ok) throw new Error(`Resend respondió ${response.status}${parsed.message ? `: ${parsed.message}` : ''}`);
      return { providerId: parsed.id ?? null };
    },
  };
}

/** What the SMTP provider needs from nodemailer (tests inject a fake). */
export type SmtpTransportFactory = (options: {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string };
}) => { sendMail(message: { from: string; to: string; subject: string; html: string; text: string; replyTo?: string }): Promise<{ messageId?: string }> };

/** SMTP account, e.g. a Gmail address with an app password. The sender defaults to that address. */
export function createSmtpProvider(
  smtp: SmtpConfig,
  from: string,
  replyTo?: string,
  createTransport: SmtpTransportFactory = nodemailer.createTransport as unknown as SmtpTransportFactory,
): MailProvider {
  const transport = createTransport({ host: smtp.host, port: smtp.port, secure: smtp.port === 465, auth: { user: smtp.user, pass: smtp.pass } });
  return {
    mode: 'smtp',
    from,
    async sendEmail(message) {
      const info = await transport.sendMail({
        from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(replyTo ? { replyTo } : {}),
      });
      return { providerId: info.messageId ?? null };
    },
  };
}

/**
 * Resend when `RESEND_API_KEY` and `MAIL_FROM` are both set; otherwise SMTP when `SMTP_USER` and `SMTP_PASS` are set;
 * otherwise simulated.
 */
export function createMailProvider(config: MailConfig, fetchImpl?: FetchLike, createTransport?: SmtpTransportFactory): MailProvider {
  if (config.resendApiKey && config.from) return createResendProvider(config.resendApiKey, config.from, config.replyTo, fetchImpl);
  if (config.smtp) return createSmtpProvider(config.smtp, config.from ?? `Plagamix <${config.smtp.user}>`, config.replyTo, createTransport);
  return createSimulatedProvider(config.from);
}
