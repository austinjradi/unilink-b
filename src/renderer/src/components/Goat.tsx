import type { CSSProperties } from 'react';
import type { GoatConfig } from '@shared/goat';
import { t } from '../lib/i18n';

// The UniLink goat: a cartoon goat head drawn in SVG, with swappable parts.

const INK = '#2b2b33';

const BACKGROUNDS: Record<GoatConfig['background'], string> = {
  mint: '#c9f2df',
  lavender: '#dddcfb',
  sky: '#cfe6fb',
  peach: '#fde0c8',
  lemon: '#faf0b4',
  rose: '#f9d3dc',
};

const FUR: Record<GoatConfig['fur'], { fur: string; muzzle: string; ear: string; horn: string }> = {
  white: { fur: '#fbfbf7', muzzle: '#f1dad5', ear: '#f3b3c1', horn: '#ece0c4' },
  cream: { fur: '#f4e7ca', muzzle: '#ebcfb2', ear: '#efa9b6', horn: '#e2d1ab' },
  caramel: { fur: '#d9a066', muzzle: '#f0caa1', ear: '#e898a6', horn: '#efe3c8' },
  gray: { fur: '#bcbfc7', muzzle: '#dcd9dc', ear: '#e4a2b0', horn: '#efe3c8' },
  charcoal: { fur: '#5b5f6b', muzzle: '#8b8f9a', ear: '#c98f9c', horn: '#d9ccae' },
};

const HORNS: Record<GoatConfig['horns'], string[]> = {
  classic: ['M50 40 C 46 26 38 18 28 17', 'M70 40 C 74 26 82 18 92 17'],
  curly: ['M50 40 C 47 26 36 20 30 27 C 25 33 33 38 37 32', 'M70 40 C 73 26 84 20 90 27 C 95 33 87 38 83 32'],
  nubs: ['M50 39 L 47 30', 'M70 39 L 73 30'],
  none: [],
};

function Eyes({ kind }: { kind: GoatConfig['eyes'] }) {
  const goatEye = (cx: number) => (
    <g key={cx}>
      <ellipse cx={cx} cy={60} rx={6.5} ry={5.5} fill="#fff" stroke={INK} strokeWidth={2} />
      <rect x={cx - 4} y={58.7} width={8} height={2.6} rx={1.3} fill={INK} />
    </g>
  );
  switch (kind) {
    case 'happy':
      return (
        <g stroke={INK} strokeWidth={2.6} strokeLinecap="round" fill="none">
          <path d="M44 61 Q50 54 56 61" />
          <path d="M64 61 Q70 54 76 61" />
          <circle cx={43} cy={70} r={3.5} fill="#f6a5b5" stroke="none" opacity={0.7} />
          <circle cx={77} cy={70} r={3.5} fill="#f6a5b5" stroke="none" opacity={0.7} />
        </g>
      );
    case 'sleepy':
      return (
        <g stroke={INK} strokeWidth={2.6} strokeLinecap="round" fill="none">
          <path d="M44 59 Q50 65 56 59" />
          <path d="M64 59 Q70 65 76 59" />
          <path d="M84 40 h5 l-5 5 h5" strokeWidth={1.8} />
        </g>
      );
    case 'shades':
      return (
        <g>
          <path d="M57 58 L63 58" stroke={INK} strokeWidth={2.5} />
          <rect x={40} y={54} width={17} height={11} rx={4} fill="#1f2230" stroke={INK} strokeWidth={1.5} />
          <rect x={63} y={54} width={17} height={11} rx={4} fill="#1f2230" stroke={INK} strokeWidth={1.5} />
          <path d="M44 57 l4 0 M67 57 l4 0" stroke="#fff" strokeWidth={1.5} strokeLinecap="round" opacity={0.7} />
        </g>
      );
    case 'glasses':
      return (
        <g>
          {goatEye(50)}
          {goatEye(70)}
          <circle cx={50} cy={60} r={9} fill="#fff" fillOpacity={0.15} stroke={INK} strokeWidth={2} />
          <circle cx={70} cy={60} r={9} fill="#fff" fillOpacity={0.15} stroke={INK} strokeWidth={2} />
          <path d="M59 59 L61 59" stroke={INK} strokeWidth={2} />
        </g>
      );
    default:
      return (
        <g>
          {goatEye(50)}
          {goatEye(70)}
        </g>
      );
  }
}

function Hat({ kind }: { kind: GoatConfig['hat'] }) {
  const line = { stroke: INK, strokeWidth: 2, strokeLinejoin: 'round' as const };
  switch (kind) {
    case 'tophat':
      return (
        <g>
          <ellipse cx={60} cy={36} rx={25} ry={5.5} fill="#2c3152" {...line} />
          <rect x={45} y={8} width={30} height={28} rx={3} fill="#2c3152" {...line} />
          <rect x={45} y={26} width={30} height={6} fill="#e8457a" />
        </g>
      );
    case 'grad':
      return (
        <g>
          <path d="M44 30 Q60 38 76 30 L76 38 Q60 44 44 38 Z" fill="#24263a" {...line} />
          <path d="M60 14 L92 26 L60 36 L28 26 Z" fill="#33375a" {...line} />
          <path d="M60 25 L86 29 L86 41" stroke="#f2c94c" strokeWidth={2} fill="none" />
          <rect x={83.5} y={40} width={5} height={7} rx={1.5} fill="#f2c94c" />
        </g>
      );
    case 'toque':
      return (
        <g>
          <path d="M36 41 C 36 16 84 16 84 41 Z" fill="#e03131" {...line} />
          <rect x={34} y={34} width={52} height={10} rx={4} fill="#c92a2a" {...line} />
          <path d="M37 39 H83" stroke="#fff" strokeWidth={2} />
          <circle cx={60} cy={15} r={6} fill="#fff" {...line} />
        </g>
      );
    case 'party':
      return (
        <g>
          <path d="M60 6 L75 38 L45 38 Z" fill="#ffd43b" {...line} />
          <path d="M53 22 L67 28 M49 31 L71 36" stroke="#4dabf7" strokeWidth={3} />
          <circle cx={60} cy={6} r={4} fill="#e64980" {...line} />
        </g>
      );
    case 'cap':
      return (
        <g>
          <path d="M58 37 C 70 32 92 33 99 40 C 88 43 70 43 58 41 Z" fill="#364fc7" {...line} />
          <path d="M38 39 C 38 19 82 19 82 39 Z" fill="#4c6ef5" {...line} />
          <circle cx={60} cy={20} r={2.5} fill="#364fc7" />
        </g>
      );
    default:
      return null;
  }
}

export function GoatSvg({ goat, background = true }: { goat: GoatConfig; background?: boolean }) {
  const c = FUR[goat.fur];
  return (
    <svg viewBox="0 0 120 120" width="100%" height="100%" role="img" aria-label={t('Goat avatar')}>
      {background && <rect width={120} height={120} fill={BACKGROUNDS[goat.background]} />}
      {HORNS[goat.horns].map((d) => (
        <g key={d} fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d={d} stroke={INK} strokeWidth={11} />
          <path d={d} stroke={c.horn} strokeWidth={7} />
        </g>
      ))}
      {[
        { cx: 31, rotate: -20 },
        { cx: 89, rotate: 20 },
      ].map(({ cx, rotate }) => (
        <g key={cx} transform={`rotate(${rotate} ${cx} 56)`}>
          <ellipse cx={cx} cy={56} rx={15} ry={6.5} fill={c.fur} stroke={INK} strokeWidth={2.2} />
          <ellipse cx={cx} cy={56} rx={9} ry={3} fill={c.ear} />
        </g>
      ))}
      <path d="M53 92 C 54 101 57 108 60 113 C 63 108 66 101 67 92" fill={c.fur} stroke={INK} strokeWidth={2.4} strokeLinejoin="round" />
      <path
        d="M60 34 C 79 34 86 48 84 64 C 82 82 74 96 60 96 C 46 96 38 82 36 64 C 34 48 41 34 60 34 Z"
        fill={c.fur}
        stroke={INK}
        strokeWidth={2.6}
      />
      <ellipse cx={60} cy={84} rx={15} ry={10.5} fill={c.muzzle} stroke={INK} strokeWidth={2} />
      <ellipse cx={55.5} cy={82} rx={1.9} ry={1.3} fill={INK} />
      <ellipse cx={64.5} cy={82} rx={1.9} ry={1.3} fill={INK} />
      <path d="M55 88 Q60 91.5 65 88" stroke={INK} strokeWidth={2} fill="none" strokeLinecap="round" />
      <Eyes kind={goat.eyes} />
      <Hat kind={goat.hat} />
    </svg>
  );
}

// A goat in the sketch-style square frame used across the app.
export function GoatAvatar({ goat, size = 40, style }: { goat: GoatConfig; size?: number; style?: CSSProperties }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        flex: 'none',
        borderRadius: Math.max(6, size / 6),
        border: `${size >= 64 ? 2.5 : 1.5}px solid var(--ul-rule)`,
        overflow: 'hidden',
        ...style,
      }}
    >
      <GoatSvg goat={goat} />
    </div>
  );
}
