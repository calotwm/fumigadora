import { eq, sql } from 'drizzle-orm';
import {
  addDays,
  addMonths,
  allocatePayment,
  endOfMonth,
  endOfWeek,
  monthLabelEs,
  nextVisitDate,
  startOfMonth,
  type Frequency,
  type IsoDate,
  type PaymentMethod,
} from '@fumigadora/shared';
import type { Db } from './db/client.js';
import { hashPassword } from './passwords.js';
import {
  allocations,
  cashEntries,
  certificates,
  clients,
  expenseCategories,
  extras,
  invoices,
  payments,
  serviceTypes,
  settings,
  users,
  visits,
} from './db/schema.js';
import { newPublicToken } from './services/publicLink.js';

/** Deterministic PRNG so seeds are reproducible for a given date. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BUSINESSES = [
  'Parrilla Don Julio',
  'Restaurante El Palenque',
  'Pizzería Los Hermanos',
  'Café del Centro',
  'Panadería La Espiga',
  'Hotel Plaza Mayor',
  'Supermercado Dragón',
  'Farmacia Central Once',
  'Gimnasio Fuerza Total',
  'Colegio San Martín',
  'Bar Notable Villa Crespo',
  'Heladería Polo Norte',
  'Carnicería La Vaca',
  'Taller Mecánico Ruiz',
];
const STREETS = [
  'Av. Corrientes',
  'Av. Rivadavia',
  'Av. Santa Fe',
  'Av. Cabildo',
  'Honduras',
  'Thames',
  'Av. Díaz Vélez',
  'Av. San Martín',
  'Gascón',
  'Bulnes',
  'Av. Scalabrini Ortiz',
  'Cuenca',
  'Av. Juan B. Justo',
  'Yerbal',
  'Av. Belgrano',
  'Defensa',
];
const AREAS = ['Palermo', 'Belgrano', 'Caballito', 'Recoleta', 'Almagro', 'Villa Urquiza', 'Flores', 'San Telmo', 'Núñez', 'Villa Crespo', 'Once', 'Devoto', 'Boedo', 'Colegiales'];
const SURNAMES = ['Rodríguez', 'Fernández', 'González', 'López', 'Martínez', 'Pérez', 'Gómez', 'Sánchez', 'Romero', 'Díaz', 'Álvarez', 'Torres'];
const FIRST_NAMES = ['Marcelo', 'Laura', 'Gustavo', 'Silvia', 'Carlos', 'Mónica', 'Roberto', 'Claudia', 'Daniel', 'Patricia', 'Hernán', 'Verónica'];
/** Approximate centre of each neighbourhood (CABA), so seeded clients have coordinates for the day route. */
const AREA_CENTERS: Record<string, [number, number]> = {
  Palermo: [-34.5889, -58.4306],
  Belgrano: [-34.5627, -58.4564],
  Caballito: [-34.6186, -58.4423],
  Recoleta: [-34.5875, -58.3974],
  Almagro: [-34.6092, -58.4194],
  'Villa Urquiza': [-34.5736, -58.4881],
  Flores: [-34.6279, -58.4639],
  'San Telmo': [-34.6214, -58.3731],
  Núñez: [-34.5434, -58.4636],
  'Villa Crespo': [-34.5993, -58.4398],
  Once: [-34.6092, -58.4065],
  Devoto: [-34.6003, -58.5116],
  Boedo: [-34.6307, -58.4189],
  Colegiales: [-34.5744, -58.4491],
};
/** Company base used by the seed (Plaza de Mayo area). */
const SEED_BASE = { address: 'Av. de Mayo 760, CABA', latitude: -34.6086, longitude: -58.3797 };

/** Deterministic offset (about +-500 m) from the client's name, so seeding stays reproducible without touching the PRNG. */
function seedCoordinates(area: string | null | undefined, name: string): { latitude: number; longitude: number } | null {
  const center = area ? AREA_CENTERS[area] : undefined;
  if (!center) return null;
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const dLat = (((h % 1000) / 1000) - 0.5) * 0.009;
  const dLon = ((((h >>> 10) % 1000) / 1000) - 0.5) * 0.009;
  return { latitude: Number((center[0] + dLat).toFixed(5)), longitude: Number((center[1] + dLon).toFixed(5)) };
}

const TIMES = ['08:00', '09:30', '11:00', '14:00', '16:00', '17:30'];

type Profile = 'good' | 'slow' | 'partial' | 'bad';

interface ClientPlan {
  id: number;
  name: string;
  kind: 'business' | 'home' | 'building';
  profile: Profile;
  monthlyFeeCents: number | null;
  priceFactor: number;
  dueDays: number;
}

interface VisitPlan {
  key: number;
  clientIdx: number;
  serviceTypeIdx: number;
  date: IsoDate;
  time: string | null;
  status: 'scheduled' | 'done' | 'cancelled';
  frequency: Frequency;
  priceCents: number | null;
  notes: string | null;
}

interface InvoicePlan {
  clientIdx: number;
  visitKey: number | null;
  issuedOn: IsoDate;
  dueOn: IsoDate;
  amountCents: number;
  description: string;
  periodMonth: string | null;
}

interface PaymentPlan {
  clientIdx: number;
  paidOn: IsoDate;
  amountCents: number;
  method: PaymentMethod;
  notes: string | null;
}

const roundTo = (cents: number, step: number) => Math.max(step, Math.round(cents / step) * step);

/** Development-only password shared by the seeded employees. */
export const SEED_EMPLOYEE_PASSWORD = 'empleado';
/** Development-only password of the seeded owner account (`lucas`). */
export const SEED_ADMIN_PASSWORD = 'lucas1234';

export interface SeedSummary {
  admins: string[];
  employees: string[];
  clients: number;
  visits: number;
  invoices: number;
  payments: number;
  cashEntries: number;
  certificates: number;
}

/**
 * Wipes all data and inserts ~5 months of realistic history relative to `today`.
 * Idempotent: running it twice yields the same shape of data.
 */
export async function runSeed(db: Db, today: IsoDate): Promise<SeedSummary> {
  const rng = mulberry32(Number(today.replace(/-/g, '')));
  const rand = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rng() * list.length)]!;
  const chance = (p: number) => rng() < p;

  await db.execute(
    sql.raw(
      'truncate table price_adjustments, push_subscriptions, notifications, route_plan_items, route_plans, email_log, settings, job_runs, allocations, payments, invoice_items, invoices, certificates, visit_extras, visits, extras, cash_entries, expense_categories, service_types, clients, users restart identity cascade',
    ),
  );

  // ---------- admin and employees ----------
  await db.insert(users).values({
    name: 'Lucas',
    username: 'lucas',
    email: 'lucas@example.com',
    passwordHash: await hashPassword(SEED_ADMIN_PASSWORD),
    role: 'admin',
    assignable: false,
  });
  const passwordHash = await hashPassword(SEED_EMPLOYEE_PASSWORD);
  const employeeRows = await db
    .insert(users)
    .values([
      { name: 'Juan Pérez', phone: '+54 9 11 5555-0101', username: 'juan', passwordHash, role: 'employee' as const },
      { name: 'Pablo Gómez', phone: '+54 9 11 5555-0102', username: 'pablo', passwordHash, role: 'employee' as const },
      { name: 'Marcos Díaz', phone: '+54 9 11 5555-0103', username: 'marcos', passwordHash, role: 'employee' as const },
    ])
    .returning({ id: users.id, username: users.username });

  await db.insert(settings).values([
    { key: 'companyAddress', value: SEED_BASE.address },
    { key: 'companyLatitude', value: SEED_BASE.latitude },
    { key: 'companyLongitude', value: SEED_BASE.longitude },
  ]);

  // ---------- catalogs ----------
  const categoryRows = await db
    .insert(expenseCategories)
    .values(['Nafta', 'Productos', 'Herramientas', 'Mantenimiento', 'Sueldos', 'Servicios', 'Otros'].map((name) => ({ name })))
    .returning();
  const category = (name: string) => categoryRows.find((c) => c.name === name)!.id;

  const serviceDefs = [
    { name: 'Desinsectación', defaultPriceCents: 45_000_00, issuesCertificate: false, certificateValidityDays: null },
    { name: 'Desratización', defaultPriceCents: 60_000_00, issuesCertificate: false, certificateValidityDays: null },
    { name: 'Desinfección', defaultPriceCents: 38_000_00, issuesCertificate: true, certificateValidityDays: 30 },
    { name: 'Control de palomas', defaultPriceCents: 85_000_00, issuesCertificate: false, certificateValidityDays: null },
    { name: 'Limpieza de tanque', defaultPriceCents: 70_000_00, issuesCertificate: true, certificateValidityDays: 180 },
  ];
  await db.insert(extras).values([
    { name: 'Cebo', priceCents: 4_500_00 },
    { name: 'Estación cebadera', priceCents: 8_000_00 },
  ]);
  const serviceRows = await db.insert(serviceTypes).values(serviceDefs).returning();
  const SVC = { insects: 0, rodents: 1, disinfection: 2, pigeons: 3, tank: 4 };

  // ---------- clients ----------
  const clientDefs: (typeof clients.$inferInsert)[] = [];
  const plans: Omit<ClientPlan, 'id'>[] = [];
  const phone = () => `+54 9 11 ${rand(4000, 6999)}-${rand(1000, 9999)}`;
  const cuit = () => `30-${rand(50000000, 71999999)}-${rand(0, 9)}`;
  const profileFor = (): Profile => {
    const r = rng();
    return r < 0.52 ? 'good' : r < 0.78 ? 'slow' : r < 0.9 ? 'partial' : 'bad';
  };
  const addClient = (
    def: Omit<typeof clients.$inferInsert, 'monthlyFeeCents'>,
    kind: ClientPlan['kind'],
    fee: number | null,
  ) => {
    clientDefs.push({ ...def, ...seedCoordinates(def.area, def.name), monthlyFeeCents: fee });
    plans.push({
      name: def.name,
      kind,
      profile: profileFor(),
      monthlyFeeCents: fee,
      priceFactor: 0.8 + rng() * 0.7,
      dueDays: kind === 'building' ? pick([10, 15, 30]) : pick([10, 10, 15]),
    });
  };

  BUSINESSES.forEach((name, i) => {
    const street = pick(STREETS);
    addClient(
      {
        name,
        kind: 'business',
        contactName: `${pick(FIRST_NAMES)} ${pick(SURNAMES)}`,
        phone: phone(),
        email: `contacto@${name.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '')}.com.ar`,
        address: `${street} ${rand(100, 5900)}, CABA`,
        area: pick(AREAS),
        taxId: cuit(),
        notes: i % 5 === 0 ? 'Coordinar visita fuera del horario de atención.' : null,
      },
      'business',
      i % 2 === 0 ? roundTo(rand(25_000, 60_000) * 100, 50_000) : null,
    );
  });
  for (let i = 0; i < 10; i++) {
    const street = pick(STREETS);
    const number = rand(100, 5900);
    addClient(
      {
        name: `Consorcio ${street} ${number}`,
        kind: 'building',
        contactName: `${pick(FIRST_NAMES)} ${pick(SURNAMES)} (administración)`,
        phone: phone(),
        email: null,
        address: `${street} ${number}, CABA`,
        area: pick(AREAS),
        taxId: cuit(),
        notes: i % 4 === 0 ? 'El encargado tiene las llaves de la terraza y la sala de máquinas.' : null,
      },
      'building',
      i % 3 !== 2 ? roundTo(rand(30_000, 80_000) * 100, 50_000) : null,
    );
  }
  const usedHomes = new Set<string>();
  while (usedHomes.size < 11) usedHomes.add(`${pick(FIRST_NAMES)} ${pick(SURNAMES)}`);
  [...usedHomes].forEach((full, i) => {
    addClient(
      {
        name: full,
        kind: 'home',
        contactName: null,
        phone: phone(),
        email: i % 3 === 0 ? `${full.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '.')}@gmail.com` : null,
        address: `${pick(STREETS)} ${rand(100, 5900)}${i % 2 === 0 ? `, ${rand(1, 9)}° ${pick(['A', 'B', 'C'])}` : ''}, CABA`,
        area: pick(AREAS),
        taxId: null,
        notes: i % 4 === 1 ? 'Tiene mascotas: avisar antes de aplicar.' : null,
      },
      'home',
      null,
    );
  });
  const clientRows = await db.insert(clients).values(clientDefs.map((c) => ({ ...c, publicToken: newPublicToken() }))).returning({ id: clients.id });
  const clientPlans: ClientPlan[] = plans.map((p, i) => ({ ...p, id: clientRows[i]!.id }));

  // ~70% of the clients have an email (example.com addresses, so a demo never mails a real person).
  for (const [i, def] of clientDefs.entries()) {
    const slug = def.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '');
    await db
      .update(clients)
      .set({ email: i % 10 < 7 ? `${slug}@example.com` : null })
      .where(eq(clients.id, clientRows[i]!.id));
  }

  // ---------- visits ----------
  const visitPlans: VisitPlan[] = [];
  let visitKey = 0;
  const price = (c: Omit<ClientPlan, 'id'>, svcIdx: number) =>
    roundTo(serviceDefs[svcIdx]!.defaultPriceCents * c.priceFactor, 50_000);

  const generate = (clientIdx: number, svcIdx: number, freq: Frequency, startAgoDays: number, billable: boolean) => {
    const c = plans[clientIdx]!;
    let date = addDays(today, -startAgoDays);
    for (let guard = 0; guard < 40; guard++) {
      const isFuture = date >= today;
      const status: VisitPlan['status'] = isFuture ? 'scheduled' : chance(0.96) ? 'done' : 'cancelled';
      visitPlans.push({
        key: visitKey++,
        clientIdx,
        serviceTypeIdx: svcIdx,
        date,
        time: chance(0.9) ? pick(TIMES) : null,
        status,
        frequency: freq,
        priceCents: billable ? price(c, svcIdx) : null,
        notes: status === 'done' && chance(0.15) ? pick(['Se aplicó gel en cocina y depósito.', 'Se observó actividad en sótano, reforzar en próxima visita.', 'Sin novedades.']) : null,
      });
      if (isFuture) break;
      const next = nextVisitDate(date, freq);
      if (!next) break;
      date = next;
    }
  };

  // ~70% of clients get a service plan (tracked in the monthly follow-up); the plan drives their visit history.
  const servicePlans = new Map<number, { serviceTypeIdx: number; frequency: Frequency }>();
  const planned = (idx: number, serviceTypeIdx: number, options: readonly Frequency[]): Frequency | null => {
    if (!chance(0.7)) return null;
    const frequency = pick(options);
    servicePlans.set(idx, { serviceTypeIdx, frequency });
    return frequency;
  };

  clientPlans.forEach((c, i) => {
    const hasFee = c.monthlyFeeCents !== null;
    if (c.kind === 'business') {
      const svc = chance(0.5) ? SVC.insects : SVC.rodents;
      const freq =
        planned(i, svc, ['weekly', 'biweekly', 'biweekly', 'monthly', 'monthly', 'monthly']) ??
        pick(['monthly', 'monthly', 'bimonthly'] as const);
      generate(i, svc, freq, rand(120, 150), !hasFee);
      if (chance(0.25)) generate(i, SVC.disinfection, 'monthly', rand(40, 100), true);
    } else if (c.kind === 'building') {
      const svc = chance(0.5) ? SVC.rodents : SVC.insects;
      const freq = planned(i, svc, ['monthly', 'monthly', 'monthly', 'bimonthly']) ?? pick(['bimonthly', 'quarterly', 'monthly'] as const);
      generate(i, svc, freq, rand(110, 150), !hasFee);
      if (chance(0.7)) generate(i, SVC.tank, 'semiannual', rand(20, 150), true);
      if (chance(0.2)) generate(i, SVC.pigeons, 'monthly', rand(60, 140), true);
    } else {
      const freq = planned(i, SVC.insects, ['bimonthly', 'quarterly', 'quarterly']) ?? pick(['quarterly', 'semiannual', 'none'] as const);
      generate(i, SVC.insects, freq, rand(15, 150), true);
    }
  });
  // Leave every third planned client without its remaining visit of the month: "pending, not scheduled yet".
  const monthEnd = endOfMonth(today);
  let planNumber = 0;
  for (const [idx, plan] of servicePlans) {
    if (planNumber++ % 3 !== 1) continue;
    const at = visitPlans.findIndex(
      (v) => v.clientIdx === idx && v.serviceTypeIdx === plan.serviceTypeIdx && v.status === 'scheduled' && v.date >= today && v.date <= monthEnd,
    );
    if (at >= 0) visitPlans.splice(at, 1);
  }
  for (const [idx, plan] of servicePlans) {
    await db
      .update(clients)
      .set({ serviceFrequency: plan.frequency, defaultServiceTypeId: serviceRows[plan.serviceTypeIdx]!.id })
      .where(eq(clients.id, clientPlans[idx]!.id));
  }

  // Deterministic agenda variety: visits today, tomorrow, rest of the week and two late ones.
  const agendaClients = [...clientPlans.keys()];
  const take = () => agendaClients.splice(rand(0, agendaClients.length - 1), 1)[0]!;
  const addScheduled = (date: IsoDate, status: 'scheduled' = 'scheduled') => {
    const idx = take();
    const svc = pick([SVC.insects, SVC.rodents, SVC.disinfection]);
    visitPlans.push({
      key: visitKey++,
      clientIdx: idx,
      serviceTypeIdx: svc,
      date,
      time: pick(TIMES),
      status,
      frequency: pick(['none', 'monthly', 'bimonthly'] as const),
      priceCents: price(plans[idx]!, svc),
      notes: null,
    });
  };
  for (let n = 0; n < 4; n++) addScheduled(today);
  for (let n = 0; n < 3; n++) addScheduled(addDays(today, 1));
  const weekEnd = endOfWeek(today);
  for (let d = 2; addDays(today, d) <= weekEnd && d <= 6; d++) {
    addScheduled(addDays(today, d));
    if (d % 2 === 0) addScheduled(addDays(today, d));
  }
  addScheduled(addDays(today, -3));
  addScheduled(addDays(today, -6));
  // Visits next week so the week/month views are not empty.
  for (let n = 0; n < 6; n++) addScheduled(addDays(today, rand(7, 20)));

  // Tank cleanings with certificates close to their expiry (6 months ago).
  const tankClients = clientPlans.map((c, i) => ({ c, i })).filter(({ c }) => c.kind === 'building').slice(0, 4);
  [8, 12, -5, 25].forEach((daysLeft, n) => {
    const target = tankClients[n];
    if (!target) return;
    visitPlans.push({
      key: visitKey++,
      clientIdx: target.i,
      serviceTypeIdx: SVC.tank,
      date: addDays(today, daysLeft - 180),
      time: pick(TIMES),
      status: 'done',
      frequency: 'semiannual',
      priceCents: price(target.c, SVC.tank),
      notes: 'Limpieza y desinfección de tanque de agua. Se entregó oblea.',
    });
  });

  visitPlans.sort((a, b) => a.date.localeCompare(b.date) || a.key - b.key);
  // ~80% of today's and upcoming visits (and the late ones) are assigned round-robin to the employees.
  const assigneeByKey = new Map<number, number>();
  let turn = 0;
  for (const v of visitPlans) {
    if (v.status !== 'scheduled' || v.date < addDays(today, -7) || !chance(0.8)) continue;
    assigneeByKey.set(v.key, employeeRows[turn++ % employeeRows.length]!.id);
  }
  const visitRows = await db
    .insert(visits)
    .values(
      visitPlans.map((v) => ({
        clientId: clientPlans[v.clientIdx]!.id,
        serviceTypeId: serviceRows[v.serviceTypeIdx]!.id,
        date: v.date,
        time: v.time,
        status: v.status,
        frequency: v.frequency,
        notes: v.notes,
        priceCents: v.priceCents,
        assignedUserId: assigneeByKey.get(v.key) ?? null,
        completedAt: v.status === 'done' ? new Date(`${v.date}T15:00:00Z`) : null,
      })),
    )
    .returning({ id: visits.id });
  const visitIdByKey = new Map(visitPlans.map((v, i) => [v.key, visitRows[i]!.id]));

  // ---------- certificates ----------
  const certPlans = visitPlans
    .filter((v) => v.status === 'done' && serviceDefs[v.serviceTypeIdx]!.issuesCertificate)
    .map((v) => ({
      clientId: clientPlans[v.clientIdx]!.id,
      visitId: visitIdByKey.get(v.key)!,
      issuedOn: v.date,
      expiresOn: addDays(v.date, serviceDefs[v.serviceTypeIdx]!.certificateValidityDays!),
    }))
    .sort((a, b) => a.issuedOn.localeCompare(b.issuedOn));
  if (certPlans.length > 0) {
    await db.insert(certificates).values(certPlans.map((c, i) => ({ ...c, number: String(1000 + i + 1) })));
  }

  // ---------- invoices ----------
  const invoicePlans: InvoicePlan[] = [];
  for (const v of visitPlans) {
    if (v.status !== 'done' || !v.priceCents) continue;
    const c = clientPlans[v.clientIdx]!;
    invoicePlans.push({
      clientIdx: v.clientIdx,
      visitKey: v.key,
      issuedOn: v.date,
      dueOn: addDays(v.date, c.dueDays),
      amountCents: v.priceCents,
      description: serviceDefs[v.serviceTypeIdx]!.name,
      periodMonth: null,
    });
  }
  // Monthly fee invoices on the 1st of each of the last 5 months and the current one.
  clientPlans.forEach((c, i) => {
    if (!c.monthlyFeeCents) return;
    for (let back = 5; back >= 0; back--) {
      const first = startOfMonth(addMonths(today, -back));
      if (first > today) continue;
      invoicePlans.push({
        clientIdx: i,
        visitKey: null,
        issuedOn: first,
        dueOn: addDays(first, c.dueDays),
        amountCents: c.monthlyFeeCents,
        description: `Abono mensual ${monthLabelEs(first.slice(0, 7))}`,
        periodMonth: first.slice(0, 7),
      });
    }
  });
  invoicePlans.sort((a, b) => a.issuedOn.localeCompare(b.issuedOn) || a.clientIdx - b.clientIdx);
  const yearCounters = new Map<string, number>();
  const numbered = invoicePlans.map((p) => {
    const year = p.issuedOn.slice(0, 4);
    const seq = (yearCounters.get(year) ?? 0) + 1;
    yearCounters.set(year, seq);
    return { ...p, number: `${year}-${String(seq).padStart(4, '0')}` };
  });
  const invoiceRows = await db
    .insert(invoices)
    .values(
      numbered.map((p) => ({
        clientId: clientPlans[p.clientIdx]!.id,
        visitId: p.visitKey === null ? null : (visitIdByKey.get(p.visitKey) ?? null),
        number: p.number,
        issuedOn: p.issuedOn,
        dueOn: p.dueOn,
        amountCents: p.amountCents,
        description: p.description,
        periodMonth: p.periodMonth,
      })),
    )
    .returning({ id: invoices.id });

  // ---------- payments (behaviour depends on the client profile) ----------
  const methods: PaymentMethod[] = ['cash', 'cash', 'transfer', 'transfer', 'transfer', 'mercadopago', 'check', 'other'];
  const paymentPlans: PaymentPlan[] = [];
  const addPayment = (clientIdx: number, paidOn: IsoDate, amountCents: number, notes: string | null = null) => {
    if (paidOn > today || amountCents <= 0) return;
    paymentPlans.push({ clientIdx, paidOn, amountCents, method: pick(methods), notes });
  };
  for (const inv of numbered) {
    const c = clientPlans[inv.clientIdx]!;
    const age = addDaysDiff(today, inv.issuedOn);
    switch (c.profile) {
      case 'good':
        addPayment(inv.clientIdx, addDays(inv.issuedOn, rand(0, c.dueDays + 2)), inv.amountCents + (chance(0.04) ? 10_000_00 : 0));
        break;
      case 'slow':
        addPayment(inv.clientIdx, addDays(inv.issuedOn, c.dueDays + rand(12, 55)), inv.amountCents);
        break;
      case 'partial': {
        const part = roundTo(inv.amountCents * (0.4 + rng() * 0.3), 100_00);
        addPayment(inv.clientIdx, addDays(inv.issuedOn, rand(5, 40)), Math.min(part, inv.amountCents));
        if (chance(0.5)) addPayment(inv.clientIdx, addDays(inv.issuedOn, rand(45, 100)), inv.amountCents - part, 'Saldo');
        break;
      }
      case 'bad':
        if (age < 75 ? chance(0.3) : chance(0.1)) addPayment(inv.clientIdx, addDays(inv.issuedOn, c.dueDays + rand(30, 70)), inv.amountCents);
        break;
    }
  }
  // Allocate chronologically per client, FIFO over invoices already issued at payment time.
  const invoiceIdx = numbered.map((p, i) => ({ ...p, id: invoiceRows[i]!.id, balance: p.amountCents }));
  paymentPlans.sort((a, b) => a.paidOn.localeCompare(b.paidOn));
  const paymentRows = await db
    .insert(payments)
    .values(
      paymentPlans.map((p) => ({
        clientId: clientPlans[p.clientIdx]!.id,
        paidOn: p.paidOn,
        amountCents: p.amountCents,
        method: p.method,
        notes: p.notes,
      })),
    )
    .returning({ id: payments.id });
  const allocationRows: { paymentId: number; invoiceId: number; amountCents: number }[] = [];
  paymentPlans.forEach((p, i) => {
    const open = invoiceIdx
      .filter((inv) => inv.clientIdx === p.clientIdx && inv.balance > 0 && inv.issuedOn <= p.paidOn)
      .map((inv) => ({ id: inv.id, balanceCents: inv.balance, dueOn: inv.dueOn, issuedOn: inv.issuedOn }));
    const { allocations: parts } = allocatePayment(p.amountCents, open);
    for (const a of parts) {
      invoiceIdx.find((inv) => inv.id === a.invoiceId)!.balance -= a.amountCents;
      allocationRows.push({ paymentId: paymentRows[i]!.id, invoiceId: a.invoiceId, amountCents: a.amountCents });
    }
  });
  if (allocationRows.length > 0) await db.insert(allocations).values(allocationRows);

  // ---------- cash collected by employees: some still "a rendir", a couple already confirmed ----------
  const cashPlan = [
    { daysAgo: 0, confirmed: false },
    { daysAgo: 0, confirmed: false },
    { daysAgo: 1, confirmed: false },
    { daysAgo: 2, confirmed: false },
    { daysAgo: 3, confirmed: false },
    { daysAgo: 6, confirmed: true },
    { daysAgo: 9, confirmed: true },
  ];
  const cashCandidates = invoiceIdx.filter((inv) => inv.balance > 0 && inv.issuedOn <= today);
  let employeePayments = 0;
  for (const [n, plan] of cashPlan.entries()) {
    const inv = cashCandidates[n * 2];
    if (!inv) break;
    const paidOn = addDays(today, -plan.daysAgo) < inv.issuedOn ? today : addDays(today, -plan.daysAgo);
    const amountCents = Math.min(inv.balance, roundTo(inv.balance * 0.6, 10_000_00));
    const [payment] = await db
      .insert(payments)
      .values({
        clientId: clientPlans[inv.clientIdx]!.id,
        paidOn,
        amountCents,
        method: 'cash',
        notes: 'Efectivo cobrado en el domicilio',
        collectedByUserId: employeeRows[n % employeeRows.length]!.id,
        handedOverAt: plan.confirmed ? new Date(`${paidOn}T21:00:00Z`) : null,
      })
      .returning({ id: payments.id });
    await db.insert(allocations).values({ paymentId: payment!.id, invoiceId: inv.id, amountCents });
    inv.balance -= amountCents;
    employeePayments++;
  }

  // ---------- cash entries ----------
  const cash: (typeof cashEntries.$inferInsert)[] = [];
  const expense = (date: IsoDate, cat: string, amountPesos: number, description: string, method: PaymentMethod = 'cash') => {
    if (date > today) return;
    cash.push({ kind: 'expense', date, amountCents: roundTo(amountPesos * 100, 500_00 / 5), categoryId: category(cat), description, method });
  };
  for (let back = 5; back >= 0; back--) {
    const first = startOfMonth(addMonths(today, -back));
    const day = (n: number) => addDays(first, n - 1);
    for (let n = 0; n < rand(4, 6); n++) expense(day(rand(1, 28)), 'Nafta', rand(12, 28) * 1000, 'Carga de combustible');
    for (let n = 0; n < rand(1, 3); n++) expense(day(rand(1, 28)), 'Productos', rand(60, 190) * 1000, pick(['Compra de insecticida', 'Cebos rodenticidas', 'Gel y trampas', 'Desinfectante concentrado']), 'transfer');
    if (chance(0.4)) expense(day(rand(1, 28)), 'Herramientas', rand(15, 70) * 1000, pick(['Pulverizador nuevo', 'Equipo de protección', 'Mangueras']));
    if (chance(0.5)) expense(day(rand(1, 28)), 'Mantenimiento', rand(20, 90) * 1000, pick(['Service de la camioneta', 'Cambio de neumáticos', 'Reparación de bomba']), 'transfer');
    expense(day(5), 'Sueldos', rand(380, 520) * 1000, 'Sueldo ayudante', 'transfer');
    expense(day(10), 'Servicios', rand(38, 62) * 1000, 'Internet y telefonía', 'transfer');
    if (chance(0.5)) expense(day(rand(1, 28)), 'Otros', rand(5, 25) * 1000, pick(['Papelería', 'Estacionamiento', 'Matafuegos']));
    if (chance(0.5)) {
      const date = day(rand(1, 28));
      if (date <= today) cash.push({ kind: 'income', date, amountCents: rand(8, 40) * 1000 * 100, categoryId: null, description: pick(['Venta de cebos', 'Trabajo particular sin factura']), method: 'cash' });
    }
  }
  cash.sort((a, b) => a.date.localeCompare(b.date));
  await db.insert(cashEntries).values(cash);

  return {
    admins: ['lucas'],
    employees: employeeRows.map((e) => e.username),
    clients: clientRows.length,
    visits: visitRows.length,
    invoices: invoiceRows.length,
    payments: paymentRows.length + employeePayments,
    cashEntries: cash.length,
    certificates: certPlans.length,
  };
}

function addDaysDiff(a: IsoDate, b: IsoDate): number {
  return Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000);
}
