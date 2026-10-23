import { EmptyState, Screen } from '@/components';
import { useSession } from '@/lib/session';

export default function More() {
  const { signOut } = useSession();

  return (
    <Screen>
      <EmptyState
        icon="ellipsis-horizontal-circle-outline"
        title="More"
        message="Budgets, bills, settings and account."
        actionLabel="Sign out"
        onAction={signOut}
      />
    </Screen>
  );
}
