import { EmptyState, Screen } from '@/components';

export default function Transactions() {
  return (
    <Screen>
      <EmptyState
        icon="list-outline"
        title="Activity"
        message="Your unified ledger of every transaction, with search and filters."
      />
    </Screen>
  );
}
