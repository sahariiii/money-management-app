import { EmptyState, Screen } from '@/components';

export default function ScanReceipt() {
  return (
    <Screen edges={['bottom']}>
      <EmptyState
        icon="camera-outline"
        title="Scan a receipt"
        message="Take a photo or pick an image. We'll match it to a transaction."
      />
    </Screen>
  );
}
