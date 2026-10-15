import { digitsOnly, isValidCuit, type IssuerTaxCondition } from '@fumigadora/shared';

const isProduction = process.env.NODE_ENV === 'production';

const DEV_SESSION_SECRET = 'dev-only-session-secret-change-me-0123456789';

export interface MailConfig {
  /** Resend API key; with `from` it switches the app from simulated to real sending. */
  resendApiKey: string | undefined;
  /** Sender, e.g. `Plagamix <avisos@dominio.com>`. */
  from: string | undefined;
  replyTo: string | undefined;
}

export type ArcaEnv = 'homologacion' | 'produccion';

/** ARCA electronic invoicing. Active only when every required value is present and valid. */
export interface ArcaConfig {
  env: ArcaEnv | undefined;
  /** 11 digits, no dashes. */
  cuit: string | undefined;
  /** PEM certificate. Never logged or returned by the API. */
  cert: string | undefined;
  /** PEM private key. Never logged or returned by the API. */
  key: string | undefined;
  ptoVta: number | undefined;
  taxCondition: IssuerTaxCondition | undefined;
  /** Names of the variables that are missing or invalid. Empty = configured. */
  missing: string[];
  configured: boolean;
}

export interface Config {
  isProduction: boolean;
  port: number;
  databaseUrl: string | undefined;
  /** Directory for the embedded PGlite database when no DATABASE_URL is set. */
  pgliteDir: string;
  adminPassword: string;
  sessionSecret: string;
  /** Session lifetime in seconds. */
  sessionTtlSeconds: number;
  mail: MailConfig;
  arca: ArcaConfig;
}

/** Accepts PEM text (real or backslash-n escaped newlines) or the base64 of a PEM file. */
export function decodePem(value: string | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  const text = raw.split('\\n').join('\n');
  if (text.includes('-----BEGIN')) return text;
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    return decoded.includes('-----BEGIN') ? decoded : undefined;
  } catch {
    return undefined;
  }
}

export function loadArcaConfig(env: NodeJS.ProcessEnv = process.env): ArcaConfig {
  const arcaEnv = env.ARCA_ENV?.trim().toLowerCase();
  const tax = env.ARCA_TAX_CONDITION?.trim().toLowerCase();
  const ptoVta = Number(env.ARCA_PTO_VTA);
  const cuitDigits = digitsOnly(env.ARCA_CUIT ?? '');
  const values = {
    env: arcaEnv === 'homologacion' || arcaEnv === 'produccion' ? (arcaEnv as ArcaEnv) : undefined,
    cuit: isValidCuit(cuitDigits) ? cuitDigits : undefined,
    cert: decodePem(env.ARCA_CERT),
    key: decodePem(env.ARCA_KEY),
    ptoVta: Number.isInteger(ptoVta) && ptoVta > 0 && ptoVta < 100000 ? ptoVta : undefined,
    taxCondition: tax === 'monotributo' || tax === 'responsable_inscripto' ? (tax as IssuerTaxCondition) : undefined,
  };
  const missing = (
    [
      ['ARCA_ENV', values.env],
      ['ARCA_CUIT', values.cuit],
      ['ARCA_CERT', values.cert],
      ['ARCA_KEY', values.key],
      ['ARCA_PTO_VTA', values.ptoVta],
      ['ARCA_TAX_CONDITION', values.taxCondition],
    ] as const
  )
    .filter(([, v]) => v === undefined)
    .map(([name]) => name);
  return { ...values, missing, configured: missing.length === 0 };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const prod = env.NODE_ENV === 'production' || isProduction;
  let adminPassword = env.ADMIN_PASSWORD;
  let sessionSecret = env.SESSION_SECRET;

  if (!adminPassword) {
    if (prod) throw new Error('ADMIN_PASSWORD is required in production');
    console.warn('[config] ADMIN_PASSWORD not set: using insecure development default "admin"');
    adminPassword = 'admin';
  }
  if (!sessionSecret) {
    if (prod) throw new Error('SESSION_SECRET is required in production');
    console.warn('[config] SESSION_SECRET not set: using insecure development default');
    sessionSecret = DEV_SESSION_SECRET;
  }

  return {
    isProduction: prod,
    port: Number(env.PORT ?? 3000),
    databaseUrl: env.DATABASE_URL || undefined,
    pgliteDir: env.PGLITE_DIR ?? './.data/pglite',
    adminPassword,
    sessionSecret,
    sessionTtlSeconds: 60 * 60 * 24 * 30,
    mail: {
      resendApiKey: env.RESEND_API_KEY?.trim() || undefined,
      from: env.MAIL_FROM?.trim() || undefined,
      replyTo: env.MAIL_REPLY_TO?.trim() || undefined,
    },
    arca: loadArcaConfig(env),
  };
}
