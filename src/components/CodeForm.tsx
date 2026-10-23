import { StyleSheet, View } from 'react-native';

import { spacing } from '@/constants/theme';

import { Button } from './Button';
import { TextField } from './TextField';

type Props = {
  code: string;
  onChangeCode: (code: string) => void;
  error?: string;
  busy: boolean;
  onVerify: () => void;
  onResend: () => void;
  onStartOver: () => void;
};

/** 6-digit email code entry with resend and start-over, for sign-up and new-device sign-in. */
export function CodeForm({ code, onChangeCode, error, busy, onVerify, onResend, onStartOver }: Props) {
  return (
    <>
      <TextField
        label="Verification code"
        placeholder="123456"
        value={code}
        onChangeText={(v) => onChangeCode(v.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        autoFocus
        returnKeyType="done"
        onSubmitEditing={onVerify}
        error={error}
      />
      <Button label="Verify" onPress={onVerify} loading={busy} disabled={code.length !== 6} />
      <View style={styles.links}>
        <Button label="Send a new code" variant="ghost" size="sm" onPress={onResend} disabled={busy} />
        <Button label="Start over" variant="ghost" size="sm" onPress={onStartOver} disabled={busy} />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  links: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: spacing.sm },
});
