import type Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';

import { categoryColors } from '@/constants/theme';
import type { Category } from '@/types';

type IconName = ComponentProps<typeof Ionicons>['name'];

const ICONS: Record<Category, IconName> = {
  Groceries: 'cart-outline',
  Food: 'restaurant-outline',
  Transport: 'car-outline',
  Shopping: 'bag-handle-outline',
  Health: 'medkit-outline',
  Entertainment: 'film-outline',
  Subscriptions: 'repeat-outline',
  'Phone & Internet': 'wifi-outline',
  Utilities: 'flash-outline',
  Housing: 'home-outline',
  Income: 'cash-outline',
  Other: 'pricetag-outline',
};

export const categoryIcon = (c: Category): IconName => ICONS[c];
export const categoryColor = (c: Category): string => categoryColors[c];
