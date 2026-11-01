import {
  alpha,
  Badge,
  Button,
  Card,
  createTheme,
  type CSSVariablesResolver,
  type MantineColorsTuple,
  Paper,
  SegmentedControl,
} from '@mantine/core';

// Look and feel from the team's wireframes (A2Team.pdf): rounded pill buttons,
// soft pastel accents, sketch-like outlined cards, and a friendly rounded type.

const periwinkle: MantineColorsTuple = [
  '#eef0ff',
  '#dcdffd',
  '#b7bdf7',
  '#9099f2',
  '#6f7aee',
  '#5a66eb',
  '#4e5bea',
  '#404cd0',
  '#3843bb',
  '#2c38a5',
];

// Dark mode surfaces, from text (0) down to the deepest fill (9). Mantine's own
// dark greys are neutral; these lean toward the periwinkle accent so cards,
// inputs, borders and the page all share one cool hue.
const dark: MantineColorsTuple = [
  '#dfe1ee',
  '#bfc2d6',
  '#9599b3',
  '#6b6f8a',
  '#43475f',
  '#33364b',
  '#2a2d40',
  '#1f2131',
  '#191a28',
  '#111219',
];

export const theme = createTheme({
  primaryColor: 'periwinkle',
  primaryShade: { light: 6, dark: 6 },
  colors: { periwinkle, dark },
  defaultRadius: 'lg',
  fontFamily: '"Nunito Variable", Nunito, system-ui, sans-serif',
  headings: { fontFamily: 'Fredoka, "Nunito Variable", system-ui, sans-serif', fontWeight: '600' },
  components: {
    Button: Button.extend({ defaultProps: { radius: 'xl' } }),
    Badge: Badge.extend({ defaultProps: { radius: 'xl' } }),
    SegmentedControl: SegmentedControl.extend({ defaultProps: { radius: 'xl' } }),
    Card: Card.extend({ defaultProps: { radius: 'xl' }, classNames: { root: 'sketch' } }),
    Paper: Paper.extend({ defaultProps: { radius: 'lg' } }),
  },
});

// In dark mode Mantine paints "light" badges, tags and chips with an opaque,
// heavily darkened shade (maroon, brown). Use a see-through tint with pastel
// text instead, which keeps the soft look of the light theme.
export const cssVariablesResolver: CSSVariablesResolver = (t) => ({
  variables: {},
  light: {},
  dark: {
    '--mantine-color-anchor': `var(--mantine-color-${t.primaryColor}-3)`,
    ...Object.fromEntries(
      Object.entries(t.colors).flatMap(([name, shades]) => [
        [`--mantine-color-${name}-light`, alpha(shades[4], 0.16)],
        [`--mantine-color-${name}-light-hover`, alpha(shades[4], 0.24)],
        [`--mantine-color-${name}-light-color`, `var(--mantine-color-${name}-2)`],
      ]),
    ),
  },
});

// Pastel colours per kind of item, shared by the calendar, feed tags and badges.
export const KIND_COLORS: Record<string, string> = {
  class: 'periwinkle',
  lecture: 'periwinkle',
  session: 'teal',
  task: 'cyan',
  assignment: 'orange',
  exam: 'red',
  quiz: 'grape',
  other: 'gray',
  graded: 'pink',
  planner: 'orange',
};
