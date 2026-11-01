// The UniLink goat ("McGoat"): every student's avatar, customized in Settings → Goat.

export const GOAT_OPTIONS = {
  hat: ['none', 'tophat', 'grad', 'toque', 'party', 'cap'],
  eyes: ['goat', 'happy', 'sleepy', 'shades', 'glasses'],
  horns: ['classic', 'curly', 'nubs', 'none'],
  fur: ['white', 'cream', 'caramel', 'gray', 'charcoal'],
  background: ['mint', 'lavender', 'sky', 'peach', 'lemon', 'rose'],
} as const;

export type GoatPart = keyof typeof GOAT_OPTIONS;
export type GoatConfig = { [K in GoatPart]: (typeof GOAT_OPTIONS)[K][number] };

export const GOAT_LABELS: Record<string, string> = {
  none: 'None',
  tophat: 'Top hat',
  grad: 'Grad cap',
  toque: 'Toque',
  party: 'Party hat',
  cap: 'Cap',
  goat: 'Goat eyes',
  happy: 'Happy',
  sleepy: 'Sleepy',
  shades: 'Shades',
  glasses: 'Glasses',
  classic: 'Classic',
  curly: 'Curly',
  nubs: 'Nubs',
};

// Students who haven't customized their goat still get a distinct one.
export function goatFor(userId: number, saved: Partial<GoatConfig> | null | undefined): GoatConfig {
  const pick = <K extends GoatPart>(part: K, salt: number) => {
    const options = GOAT_OPTIONS[part];
    return options[(userId * 7 + salt) % options.length] as GoatConfig[K];
  };
  return {
    hat: 'none',
    eyes: 'goat',
    horns: 'classic',
    fur: pick('fur', 1),
    background: pick('background', 3),
    ...saved,
  };
}

export function isGoatConfig(value: unknown): value is GoatConfig {
  if (typeof value !== 'object' || value == null) return false;
  return (Object.keys(GOAT_OPTIONS) as GoatPart[]).every((part) =>
    (GOAT_OPTIONS[part] as readonly string[]).includes((value as Record<string, string>)[part]),
  );
}
