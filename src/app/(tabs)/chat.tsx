import { EmptyState, Screen } from '@/components';

export default function Chat() {
  return (
    <Screen>
      <EmptyState
        icon="sparkles-outline"
        title="Assistant"
        message="Ask about your spending. The assistant remembers your habits over time."
      />
    </Screen>
  );
}
