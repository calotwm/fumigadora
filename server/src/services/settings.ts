import { inArray } from 'drizzle-orm';
import { z } from 'zod';
import { DEFAULT_REMINDER_RULES, NOTICE_MODES, type NoticeMode, type ReminderRules } from '@fumigadora/shared';
import type { Db } from '../db/client.js';
import { settings } from '../db/schema.js';

export interface AppSettings {
  debtRemindersEnabled: boolean;
  debtReminderEveryDays: number;
  debtReminderMinDaysOverdue: number;
  noticeMode: NoticeMode;
  noticeDaysBefore: number;
  /** Emit new invoices in ARCA automatically (only when ARCA is configured). */
  arcaAutoEmit: boolean;
  /** Where the day route starts: the company's address and coordinates (no geocoding, the owner types them). */
  companyAddress: string | null;
  companyLatitude: number | null;
  companyLongitude: number | null;
  /** Shown on the public client page so residents can reach the company. */
  companyPhone: string | null;
  /** Debt reminders also warn that IPC interest will start if the debt is not paid within `ipcWarningGraceDays`. */
  ipcWarningEnabled: boolean;
  ipcWarningGraceDays: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  debtRemindersEnabled: DEFAULT_REMINDER_RULES.enabled,
  debtReminderEveryDays: DEFAULT_REMINDER_RULES.everyDays,
  debtReminderMinDaysOverdue: DEFAULT_REMINDER_RULES.minDaysOverdue,
  noticeMode: 'on_approve',
  noticeDaysBefore: 7,
  arcaAutoEmit: false,
  companyAddress: null,
  companyLatitude: null,
  companyLongitude: null,
  companyPhone: null,
  ipcWarningEnabled: false,
  ipcWarningGraceDays: 10,
};

export const settingsPatch = z
  .object({
    debtRemindersEnabled: z.boolean(),
    debtReminderEveryDays: z.number().int().min(1, 'Debe ser al menos 1 día').max(365),
    debtReminderMinDaysOverdue: z.number().int().min(0, 'No puede ser negativo').max(365),
    noticeMode: z.enum(NOTICE_MODES),
    noticeDaysBefore: z.number().int().min(1, 'Debe ser al menos 1 día').max(60),
    arcaAutoEmit: z.boolean(),
    companyAddress: z.string().trim().max(300).nullable(),
    companyLatitude: z.number().min(-90, 'Latitud inválida').max(90, 'Latitud inválida').nullable(),
    companyLongitude: z.number().min(-180, 'Longitud inválida').max(180, 'Longitud inválida').nullable(),
    companyPhone: z.string().trim().max(60).nullable(),
    ipcWarningEnabled: z.boolean(),
    ipcWarningGraceDays: z.number().int().min(1, 'Debe ser al menos 1 día').max(90, 'Como máximo 90 días'),
  })
  .partial();

export async function getSettings(db: Db): Promise<AppSettings> {
  const rows = await db.select().from(settings);
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const parsed = settingsPatch.safeParse(stored);
  return { ...DEFAULT_SETTINGS, ...(parsed.success ? parsed.data : {}) } as AppSettings;
}

export async function updateSettings(db: Db, patch: z.infer<typeof settingsPatch>): Promise<AppSettings> {
  // `null` (or an empty text) clears the setting: the row is removed and the default applies again.
  const cleared = Object.entries(patch)
    .filter(([, value]) => value === null || value === '')
    .map(([key]) => key);
  if (cleared.length > 0) await db.delete(settings).where(inArray(settings.key, cleared));
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === null || value === '') continue;
    await db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
  }
  return getSettings(db);
}

export function reminderRules(s: AppSettings): ReminderRules {
  return { enabled: s.debtRemindersEnabled, everyDays: s.debtReminderEveryDays, minDaysOverdue: s.debtReminderMinDaysOverdue };
}
