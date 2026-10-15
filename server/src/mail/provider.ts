import type { MailConfig } from '../config.js';

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
  mode: 'resend' | 'simulated';
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

/** Real provider when `RESEND_API_KEY` and `MAIL_FROM` are both set, simulated otherwise. */
export function createMailProvider(config: MailConfig, fetchImpl?: FetchLike): MailProvider {
  if (config.resendApiKey && config.from) return createResendProvider(config.resendApiKey, config.from, config.replyTo, fetchImpl);
  return createSimulatedProvider(config.from);
}
