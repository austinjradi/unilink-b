// Text someone is still writing, kept on this device until it's sent, so a stray click or a
// closed tab doesn't lose it. Each account has its own, so a shared computer doesn't mix them.

const PREFIX = 'unilink-draft-';
const keyFor = (userId: number, name: string) => `${PREFIX}${userId}-${name}`;

export function loadDraft<T>(userId: number, name: string): T | null {
  try {
    const saved = localStorage.getItem(keyFor(userId, name));
    return saved ? (JSON.parse(saved) as T) : null;
  } catch {
    return null;
  }
}

// null forgets it.
export function saveDraft(userId: number, name: string, value: unknown) {
  try {
    if (value == null) localStorage.removeItem(keyFor(userId, name));
    else localStorage.setItem(keyFor(userId, name), JSON.stringify(value));
  } catch {
    // Storage is off or full: nothing is kept, and writing still works.
  }
}

// When an account is deleted, its drafts go too.
export function clearDrafts(userId: number) {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(keyFor(userId, ''))) localStorage.removeItem(key);
    }
  } catch {
    // As above.
  }
}
