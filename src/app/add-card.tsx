import { router } from 'expo-router';

import { CardForm, Screen } from '@/components';
import { addCard } from '@/lib/api';

export default function AddCard() {
  return (
    <Screen edges={['bottom']} width="narrow">
      <CardForm
        submitLabel="Save card"
        onSubmit={async (input) => {
          await addCard(input);
          router.back();
        }}
      />
    </Screen>
  );
}
