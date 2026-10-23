import { Platform } from 'react-native';

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
} as const;

/** Chart palette, one color per category. Distinct hues, readable on white. */
export const categoryColors = {
  Groceries: '#16A34A',
  Food: '#F97316',
  Transport: '#0EA5E9',
  Shopping: '#A855F7',
  Health: '#EC4899',
  Entertainment: '#EAB308',
  Subscriptions: '#6366F1',
  'Phone & Internet': '#14B8A6',
  Utilities: '#64748B',
  Housing: '#334155',
  Income: '#22C55E',
  Other: '#94A3B8',
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

export const fontSize = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 22,
  xxl: 28,
  display: 36,
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

export const layout = {
  maxContentWidth: 900,
  readableWidth: 400,
  /** Window width at which layouts switch from phone to wide. */
  wideBreakpoint: 720,
  chartHeight: 180,
  donutRadius: 80,
  fabSize: 56,
  /** Width / height of a real payment card. */
  cardAspectRatio: 1.586,
  chatBubbleMaxWidth: '82%',
  inputHeight: 44,
  receiptMaxHeight: 320,
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

export const theme = { colors, spacing, radius, fontSize, fontWeight, layout, shadow };
export type ColorToken = keyof typeof colors;
