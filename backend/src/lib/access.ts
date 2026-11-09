import { Role, type Prisma, type User } from '../generated/prisma/client.js';
import { db } from './db.js';

// Who a person may see in organisation-wide views, such as alerts and reports. Kept in one place so
// that every endpoint applies the same rules: admins and HR see everyone, managers their direct reports.
export function visibleUsersWhere(actor: User): Prisma.UserWhereInput {
  if (actor.role === Role.ADMIN || actor.role === Role.HR) return {};
  if (actor.role === Role.MANAGER) return { managerId: actor.id };
  return { id: actor.id };
}

export const isOversight = (actor: User) => actor.role === Role.ADMIN || actor.role === Role.HR;

// Whether the actor may act on someone else's case. Nobody acts on their own.
export function canReviewPerson(actor: User, subject: Pick<User, 'id' | 'managerId'>) {
  if (actor.id === subject.id) return false;
  if (isOversight(actor)) return true;
  return actor.role === Role.MANAGER && subject.managerId === actor.id;
}

// The people who receive HR escalations: HR if there are any, otherwise the admins, so nothing goes unseen.
export async function hrRecipients() {
  const hr = await db.user.findMany({ where: { role: Role.HR, active: true } });
  return hr.length ? hr : db.user.findMany({ where: { role: Role.ADMIN, active: true } });
}
