import { router, useLocalSearchParams } from 'expo-router';

import { CardForm, EmptyState, Loading, Screen, useToast } from '@/components';
import { useAsync } from '@/hooks/use-async';
import { deleteCard, getCard, getRewardRules, updateCard } from '@/lib/api';

export default function EditCard() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const card = useAsync(() => getCard(id), id);
  const rules = useAsync(() => getRewardRules(id), id);
  const toast = useToast();

  // The form copies the card once, so wait for both the card and its rules.
  if (card.data === undefined || !rules.data) {
    return (
      <Screen edges={['bottom']} width="narrow">
        {card.error || rules.error ? (
          <EmptyState icon="cloud-offline-outline" title="Couldn't load this card" message={(card.error ?? rules.error)?.message} />
        ) : (
          <Loading />
        )}
      </Screen>
    );
  }

  const c = card.data;
  if (!c || c.isPlaceholder) {
    return (
      <Screen edges={['bottom']} width="narrow">
        <EmptyState
          icon="help-circle-outline"
          title="Card not found"
          message={c ? "The placeholder card can't be edited. Add your own card instead." : 'It may have been deleted.'}
        />
      </Screen>
    );
  }

  return (
    <Screen edges={['bottom']} width="narrow">
      <CardForm
        key={c.id}
        initial={{ card: c, rules: rules.data }}
        submitLabel="Save changes"
        onSubmit={async (input) => {
          await updateCard(c.id, input);
          toast('Card updated');
          router.back();
        }}
        onDelete={async () => {
          await deleteCard(c.id);
          toast(`${c.nickname} deleted`);
          router.back();
        }}
      />
    </Screen>
  );
}
