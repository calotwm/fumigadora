import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { USER_ROLES } from '@fumigadora/shared';
import type { Db } from '../db/client.js';
import { users, type User } from '../db/schema.js';
import { conflict, definedOnly, notFound, zOptText } from '../http.js';
import { hashPassword } from '../passwords.js';

const zUsername = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,40}$/, 'El usuario debe tener 3 a 40 caracteres: letras, números, punto, guion o guion bajo');
const zPassword = z.string().min(6, 'La contraseña debe tener al menos 6 caracteres').max(200);

export const userInput = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio').max(120),
  phone: zOptText(60),
  username: zUsername,
  password: zPassword,
  role: z.enum(USER_ROLES).default('employee'),
});
export const userPatch = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio').max(120).optional(),
  phone: zOptText(60),
  username: zUsername.optional(),
  role: z.enum(USER_ROLES).optional(),
  active: z.boolean().optional(),
});
export const passwordInput = z.object({ password: zPassword });

/** Public shape: never includes the password hash. */
export function userView(u: User) {
  return {
    id: u.id,
    name: u.name,
    phone: u.phone,
    username: u.username,
    role: u.role,
    active: u.active,
    createdAt: u.createdAt,
  };
}

async function requireUser(db: Db, id: number): Promise<User> {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  if (!row) throw notFound('Usuario');
  return row;
}

async function assertUsernameFree(db: Db, username: string, exceptId?: number) {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.username, username));
  if (row && row.id !== exceptId) throw conflict('Ese nombre de usuario ya está en uso', 'duplicate');
}

export async function listUsers(db: Db) {
  const rows = await db.select().from(users).orderBy(asc(users.name));
  return rows.map(userView);
}

export async function createUser(db: Db, input: z.infer<typeof userInput>) {
  await assertUsernameFree(db, input.username);
  const [row] = await db
    .insert(users)
    .values({
      name: input.name,
      phone: input.phone ?? null,
      username: input.username,
      passwordHash: await hashPassword(input.password),
      role: input.role,
    })
    .returning();
  return userView(row!);
}

export async function updateUser(db: Db, id: number, patch: z.infer<typeof userPatch>) {
  await requireUser(db, id);
  if (patch.username !== undefined) await assertUsernameFree(db, patch.username, id);
  const values = definedOnly(patch);
  if (Object.keys(values).length > 0) await db.update(users).set(values).where(eq(users.id, id));
  return userView(await requireUser(db, id));
}

export async function resetPassword(db: Db, id: number, password: string) {
  await requireUser(db, id);
  await db.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, id));
  return { ok: true as const };
}

/** Active user that can be assigned to a visit. */
export async function requireAssignee(db: Db, id: number) {
  const user = await requireUser(db, id);
  if (!user.active) throw conflict('El empleado está desactivado');
  return user;
}
