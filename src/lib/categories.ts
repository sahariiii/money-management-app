import type Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';

import { categoryColors } from '@/constants/theme';
import type { Category } from '@/types';

type IconName = ComponentProps<typeof Ionicons>['name'];

const ICONS: Record<Category, IconName> = {
  Groceries: 'cart-outline',
  Food: 'restaurant-outline',
  'Gas & EV charging': 'speedometer-outline',
  Transport: 'bus-outline',
  Car: 'car-outline',
  Shopping: 'bag-handle-outline',
  Health: 'medkit-outline',
  Entertainment: 'film-outline',
  Subscriptions: 'repeat-outline',
  'Phone & Internet': 'wifi-outline',
  Utilities: 'flash-outline',
  Housing: 'home-outline',
  'Fees & interest': 'calculator-outline',
  Other: 'pricetag-outline',
  Work: 'briefcase-outline',
  'Tax refund': 'receipt-outline',
  'Side income': 'trending-up-outline',
  Reimbursement: 'return-down-back-outline',
  'Other income': 'cash-outline',
};

export const categoryIcon = (c: Category): IconName => ICONS[c];
export const categoryColor = (c: Category): string => categoryColors[c];
