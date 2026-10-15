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
}

export const DEFAULT_SETTINGS: AppSettings = {
  debtRemindersEnabled: DEFAULT_REMINDER_RULES.enabled,
  debtReminderEveryDays: DEFAULT_REMINDER_RULES.everyDays,
  debtReminderMinDaysOverdue: DEFAULT_REMINDER_RULES.minDaysOverdue,
  noticeMode: 'on_approve',
  noticeDaysBefore: 7,
  arcaAutoEmit: false,
};

export const settingsPatch = z
  .object({
    debtRemindersEnabled: z.boolean(),
    debtReminderEveryDays: z.number().int().min(1, 'Debe ser al menos 1 día').max(365),
    debtReminderMinDaysOverdue: z.number().int().min(0, 'No puede ser negativo').max(365),
    noticeMode: z.enum(NOTICE_MODES),
    noticeDaysBefore: z.number().int().min(1, 'Debe ser al menos 1 día').max(60),
    arcaAutoEmit: z.boolean(),
  })
  .partial();

export async function getSettings(db: Db): Promise<AppSettings> {
  const rows = await db.select().from(settings);
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const parsed = settingsPatch.safeParse(stored);
  return { ...DEFAULT_SETTINGS, ...(parsed.success ? parsed.data : {}) } as AppSettings;
}

export async function updateSettings(db: Db, patch: z.infer<typeof settingsPatch>): Promise<AppSettings> {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    await db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
  }
  return getSettings(db);
}

export function reminderRules(s: AppSettings): ReminderRules {
  return { enabled: s.debtRemindersEnabled, everyDays: s.debtReminderEveryDays, minDaysOverdue: s.debtReminderMinDaysOverdue };
}
