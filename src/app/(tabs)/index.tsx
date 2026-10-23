import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AlertBanner, Chip, EmptyState, Screen, SectionHeader } from '@/components';
import { spacing } from '@/constants/theme';

export default function Home() {
  return (
    <Screen>
      <AlertBanner
        tone="info"
        title="UI preview"
        message="Dashboard with balance, spending and bill alerts comes next."
      />
      <SectionHeader title="Quick actions" />
      <View style={styles.chips}>
        <Chip label="Upload statement" onPress={() => router.push('/upload-statement')} />
        <Chip label="Scan receipt" onPress={() => router.push('/scan-receipt')} />
        <Chip label="Sample transaction" onPress={() => router.push('/transaction/demo')} />
      </View>
      <EmptyState
        icon="home-outline"
        title="Home"
        message="Balance, spending summary, budgets and upcoming bills will live here."
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
