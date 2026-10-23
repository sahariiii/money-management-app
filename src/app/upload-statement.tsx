import { EmptyState, Screen } from '@/components';

export default function UploadStatement() {
  return (
    <Screen edges={['bottom']}>
      <EmptyState
        icon="cloud-upload-outline"
        title="Upload a bank statement"
        message="Pick a PDF or CSV statement. We'll extract transactions into your ledger."
      />
    </Screen>
  );
}
