import { Badge, Button, Card, createTheme, type MantineColorsTuple, Paper, SegmentedControl } from '@mantine/core';

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

export const theme = createTheme({
  primaryColor: 'periwinkle',
  colors: { periwinkle },
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
