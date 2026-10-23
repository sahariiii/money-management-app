import { useLocalSearchParams } from 'expo-router';

import { EmptyState, Screen } from '@/components';

export default function TransactionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <Screen edges={['bottom']}>
      <EmptyState
        icon="receipt-outline"
        title="Transaction details"
        message={`Transaction ${id}: merchant, category, card used and attached receipt.`}
      />
    </Screen>
  );
}
