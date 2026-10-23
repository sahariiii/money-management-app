import { EmptyState, Screen } from '@/components';

export default function Cards() {
  return (
    <Screen>
      <EmptyState
        icon="card-outline"
        title="Cards"
        message="Your cards (last 4 digits only) and which one earns the most rewards per category."
      />
    </Screen>
  );
}
