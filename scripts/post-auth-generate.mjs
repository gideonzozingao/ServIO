// Re-applies the tweaks Better Auth's generator does not emit, so `auth:generate` is repeatable.
// Adds @db.Uuid to id/FK columns of auth models. Review the diff after every run.
import { readFileSync, writeFileSync } from 'node:fs';
const file = new URL('../prisma/schema/auth.prisma', import.meta.url);
let src = readFileSync(file, 'utf8');
const idLike = /^(\s+)(id|userId|organizationId|inviterId|activeOrganizationId|deviceId|approverId|approvedBy|subjectId)(\s+)(String\??)(?![^\n]*@db\.Uuid)([^\n]*)$/gm;
src = src.replace(idLike, (_m, ind, name, sp, type, rest) => `${ind}${name}${sp}${type}${rest} @db.Uuid`);
writeFileSync(file, src);
console.log('auth.prisma: @db.Uuid applied');
