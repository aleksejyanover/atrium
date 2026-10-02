import { Feather } from '@expo/vector-icons';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/controls';
import { colors } from '@/lib/theme';

interface Props {
  byName: string;
  reason: string;
  onExit(): void;
}

/**
 * Блокирующее полноэкранное окно бана (SPEC v8 §35):
 * «Вас забанил(а) X. Причина: Y» + только кнопка «Выйти» — крестика и
 * закрытия нет, выход сбрасывает токен и уводит на экран входа.
 */
export function BanOverlay({ byName, reason, onExit }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible animationType="fade">
      <View
        style={[
          styles.screen,
          { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 32 },
        ]}>
        <View style={styles.iconWrap}>
          <Feather name="alert-triangle" size={34} color={colors.danger} />
        </View>
        <Text style={styles.title}>Внимание!</Text>
        <Text style={styles.message}>{`Вас забанил(а) ${byName}. Причина: ${reason}`}</Text>
        <View style={styles.actions}>
          <Button title="Выйти" variant="danger" onPress={onExit} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 14,
  },
  iconWrap: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: 'rgba(240,80,110,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(240,80,110,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '700',
  },
  message: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  actions: {
    width: '100%',
    maxWidth: 320,
    marginTop: 10,
  },
});
