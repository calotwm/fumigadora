import { eq, and } from 'drizzle-orm';
import type { ArcaInvoiceRequest } from '@fumigadora/shared';
import type { ArcaConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { arcaTokens } from '../db/schema.js';
import { WSAA_URLS, WSFE_SERVICE_ID, requestAccessTicket, type AccessTicket } from './wsaa.js';
import {
  WSFE_URLS,
  buildAuthorizeRequest,
  buildConsultRequest,
  buildDummyRequest,
  buildLastAuthorizedRequest,
  parseAuthorizeResponse,
  parseConsultResponse,
  parseDummyResponse,
  parseLastAuthorizedResponse,
  soapCall,
  type ArcaMessage,
  type WsfeAuth,
} from './wsfe.js';
import { ArcaError } from './xml.js';

/** The values of a complete ARCA configuration. */
export type ReadyArcaConfig = { [K in 'env' | 'cuit' | 'cert' | 'key' | 'ptoVta' | 'taxCondition']-?: NonNullable<ArcaConfig[K]> };

/** The ticket is renewed this long before it expires. */
const RENEW_MARGIN_MS = 10 * 60_000;

export function formatMessages(list: ArcaMessage[]): string {
  return list.map((m) => `${m.code}: ${m.msg}`).join(' | ');
}

/** WSAA + WSFEv1 client. Only constructed with a complete configuration. */
/** One ticket request at a time (WSAA refuses a second ticket while a valid one exists). */
let ticketLock: Promise<unknown> = Promise.resolve();

export class ArcaClient {
  constructor(
    private readonly db: Db,
    private readonly cfg: ReadyArcaConfig,
    private readonly fetchFn: typeof fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private get wsfeUrl() {
    return WSFE_URLS[this.cfg.env];
  }

  /** Access ticket from the DB cache, or a fresh one from WSAA (never asked twice while a valid one exists). */
  private async ticket(forceRenew = false): Promise<AccessTicket> {
    const run = async (): Promise<AccessTicket> => {
      const key = and(eq(arcaTokens.env, this.cfg.env), eq(arcaTokens.service, WSFE_SERVICE_ID));
      if (!forceRenew) {
        const [cached] = await this.db.select().from(arcaTokens).where(key);
        if (cached && cached.expiresAt.getTime() - this.now().getTime() > RENEW_MARGIN_MS) {
          return { token: cached.token, sign: cached.sign, expiresAt: cached.expiresAt };
        }
      }
      const fresh = await requestAccessTicket(this.fetchFn, WSAA_URLS[this.cfg.env], this.cfg.cert, this.cfg.key, this.now());
      await this.db
        .insert(arcaTokens)
        .values({ env: this.cfg.env, service: WSFE_SERVICE_ID, token: fresh.token, sign: fresh.sign, expiresAt: fresh.expiresAt })
        .onConflictDoUpdate({
          target: [arcaTokens.env, arcaTokens.service],
          set: { token: fresh.token, sign: fresh.sign, expiresAt: fresh.expiresAt, createdAt: new Date() },
        });
      return fresh;
    };
    const next = ticketLock.then(run, run);
    ticketLock = next.catch(() => undefined);
    return next;
  }

  private async auth(forceRenew = false): Promise<WsfeAuth> {
    const t = await this.ticket(forceRenew);
    return { token: t.token, sign: t.sign, cuit: this.cfg.cuit };
  }

  /** Runs an authenticated call; if ARCA says the token is not valid, renews the ticket once and retries. */
  private async authed<T extends { errors: ArcaMessage[] }>(call: (a: WsfeAuth) => Promise<T>): Promise<T> {
    const first = await call(await this.auth());
    if (first.errors.some((e) => /token|sign/i.test(e.msg))) return call(await this.auth(true));
    return first;
  }

  /** Makes sure a valid access ticket exists (asks WSAA when the cached one is missing or about to expire). */
  async login(): Promise<void> {
    await this.ticket();
  }

  async dummy() {
    return parseDummyResponse(await soapCall(this.fetchFn, this.wsfeUrl, 'FEDummy', buildDummyRequest()));
  }

  async lastAuthorized(cbteTipo: number): Promise<number> {
    const r = await this.authed(async (a) =>
      parseLastAuthorizedResponse(
        await soapCall(this.fetchFn, this.wsfeUrl, 'FECompUltimoAutorizado', buildLastAuthorizedRequest(a, this.cfg.ptoVta, cbteTipo)),
      ),
    );
    if (r.errors.length) throw new ArcaError(`ARCA: ${formatMessages(r.errors)}`);
    return r.lastNumber;
  }

  async consult(cbteTipo: number, cbteNro: number) {
    const r = await this.authed(async (a) =>
      parseConsultResponse(
        await soapCall(this.fetchFn, this.wsfeUrl, 'FECompConsultar', buildConsultRequest(a, this.cfg.ptoVta, cbteTipo, cbteNro)),
      ),
    );
    return r;
  }

  async authorize(request: ArcaInvoiceRequest) {
    return this.authed(async (a) => parseAuthorizeResponse(await soapCall(this.fetchFn, this.wsfeUrl, 'FECAESolicitar', buildAuthorizeRequest(a, request))));
  }
}
