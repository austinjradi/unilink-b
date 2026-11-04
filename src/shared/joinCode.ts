// 'join-code': short enough to read out in class. It stands for the section's id, as a class link does.
const OFFSET = 46656;
const STEP = 7919;

export const joinCodeFor = (classId: number) => (classId * STEP + OFFSET).toString(36).toUpperCase();

export function classFromJoinCode(code: string) {
  const classId = (parseInt(code.trim(), 36) - OFFSET) / STEP;
  return Number.isInteger(classId) && classId > 0 ? classId : null;
}
