import { Platform, StyleSheet } from 'react-native';

export const colors = {
  bg: '#F5F7FB',
  card: '#FFFFFF',
  text: '#0F172A',
  muted: '#64748B',
  primary: '#4F46E5',
  primarySoft: '#EEF2FF',
  onPrimary: '#FFFFFF',
  income: '#16A34A',
  incomeSoft: '#DCFCE7',
  expense: '#DC2626',
  expenseSoft: '#FEE2E2',
  warning: '#D97706',
  warningSoft: '#FEF3C7',
  border: '#E2E8F0',
  track: '#EDF1F7',
  shadow: '#0F172A',
  toast: '#1E293B',
} as const;

/** Chart palette, one color per category. Distinct hues, readable on white. */
export const categoryColors = {
  Groceries: '#16A34A',
  Food: '#F97316',
  'Gas & EV charging': '#B45309',
  Transport: '#0EA5E9',
  Car: '#1D4ED8',
  Shopping: '#A855F7',
  Health: '#EC4899',
  Entertainment: '#EAB308',
  Subscriptions: '#6366F1',
  'Phone & Internet': '#14B8A6',
  Utilities: '#64748B',
  Housing: '#334155',
  'Fees & interest': '#78716C',
  Other: '#94A3B8',
  // Income: greens and teals, shown apart from spending.
  Work: '#22C55E',
  'Tax refund': '#0D9488',
  'Side income': '#65A30D',
  Reimbursement: '#0891B2',
  'Other income': '#4D7C0F',
} as const;

/** Gradients for the payment-card visuals, picked by card type. */
export const cardGradients = {
  debit: ['#1E293B', '#475569'],
  credit: ['#4F46E5', '#7C3AED'],
} as const;

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

export const borderWidth = {
  hairline: StyleSheet.hairlineWidth,
  thin: 1,
  thick: 2,
} as const;

export const fontSize = {
  xxs: 11,
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 22,
  xxl: 28,
  display: 36,
} as const;

export const lineHeight = {
  sm: 20,
  md: 22,
} as const;

export const letterSpacing = {
  wide: 0.5,
  card: 2,
} as const;

export const fontFamily = {
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, Menlo, Consolas, monospace' }),
} as const;

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

/**
 * The type scale. Spread a preset into a StyleSheet entry (and override color or
 * alignment if needed) instead of picking sizes and weights by hand.
 */
export const typography = {
  /** Screen greeting, e.g. "Good morning". */
  title: { fontSize: fontSize.xxl, fontWeight: fontWeight.bold, color: colors.text },
  /** Section and card titles. */
  heading: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },
  /** Row titles: merchant names, list items. */
  subheading: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  body: { fontSize: fontSize.md, lineHeight: lineHeight.md, color: colors.text },
  bodyMuted: { fontSize: fontSize.md, lineHeight: lineHeight.md, color: colors.muted },
  /** Form labels and emphasized small text. */
  label: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text },
  small: { fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: colors.text },
  muted: { fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: colors.muted },
  caption: { fontSize: fontSize.xs, color: colors.muted },
  /** Small uppercase labels above groups, e.g. "DATES". */
  overline: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: letterSpacing.wide,
  },
  /** KPI numbers in stat tiles and summary cards. */
  stat: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text },
  /** The big amount on a transaction. */
  amount: { fontSize: fontSize.display, fontWeight: fontWeight.bold, color: colors.text },
} as const;

export const layout = {
  maxContentWidth: 900,
  /** Forms, detail pages and chat: easier to read than the full 900px. */
  narrowContentWidth: 680,
  readableWidth: 400,
  /** Window width at which layouts switch from phone to wide. */
  wideBreakpoint: 720,
  chartHeight: 180,
  /** Taller line chart on wide screens, so it fills a card the height of the donut beside it. */
  chartHeightWide: 290,
  donutRadius: 80,
  /** Width / height of a real payment card. */
  cardAspectRatio: 1.586,
  chatBubbleMaxWidth: '82%',
  inputHeight: 44,
  receiptMaxHeight: 320,
  monthLabelWidth: 120,
  /** Distance of the toast from the bottom edge, clear of the tab bar. */
  toastOffset: 72,
  iconSize: 22,
  avatarSize: 40,
  progressHeight: 8,
} as const;

export const shadow = {
  shadowColor: colors.shadow,
  shadowOpacity: 0.06,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
} as const;

export const theme = { colors, spacing, radius, fontSize, fontWeight, typography, layout, shadow };
export type ColorToken = keyof typeof colors;
