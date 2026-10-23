import { router } from 'expo-router';

import type { Alert } from '@/types';
import { AlertBanner } from './AlertBanner';

const ALERT_UI: Record<Alert['type'], { title: string; tone: 'warning' | 'danger' | 'info' }> = {
  bill_change: { title: 'Bill went up', tone: 'danger' },
  budget: { title: 'Budget check', tone: 'warning' },
  duplicate: { title: 'Possible duplicate', tone: 'info' },
  unusual: { title: 'Unusual charge', tone: 'warning' },
};

type Props = {
  alert: Alert;
  /** Shows a "This is fine" button on open alerts. */
  onDismiss?: (id: string) => void;
};

/** An alert from the API, with "Check" and dismiss actions. Dismissed alerts are greyed out. */
export function AlertItem({ alert, onDismiss }: Props) {
  const ui = ALERT_UI[alert.type];
  const dismissed = alert.status === 'dismissed';

  const check = () => {
    if (alert.transactionId) router.push(`/transaction/${alert.transactionId}`);
    else if (alert.type === 'budget') router.push('/more');
    else router.push('/transactions');
  };

  return (
    <AlertBanner
      tone={ui.tone}
      title={ui.title}
      message={alert.message}
      muted={dismissed}
      meta={dismissed ? 'Dismissed' : undefined}
      actions={
        dismissed
          ? []
          : [
              { label: 'Check', onPress: check },
              ...(onDismiss ? [{ label: 'This is fine', onPress: () => onDismiss(alert.id) }] : []),
            ]
      }
    />
  );
}
