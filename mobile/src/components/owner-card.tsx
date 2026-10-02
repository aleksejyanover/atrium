import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { ownerSerial } from '@/lib/format';
import { colors, radius } from '@/lib/theme';

interface Props {
  displayName: string;
  username: string;
  userId: string;
}

/**
 * Стилизованная карточка владельца (SPEC v5 §30): градиент #2A2140 → #17171C,
 * рамка #F5BE41, надпись «ВЛАДЕЛЕЦ», имя, «Баланс: ∞», серийный OWNER-XXXX.
 */
export function OwnerCard({ displayName, username, userId }: Props) {
  const [size, setSize] = useState({ w: 0, h: 0 });

  return (
    <View
      style={styles.card}
      onLayout={(e) =>
        setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })
      }>
      {size.w > 0 && size.h > 0 ? (
        <Svg style={StyleSheet.absoluteFill} width={size.w} height={size.h}>
          <Defs>
            <LinearGradient id="ownerCardGradient" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#2A2140" />
              <Stop offset="1" stopColor="#17171C" />
            </LinearGradient>
          </Defs>
          <Rect width={size.w} height={size.h} rx={radius.lg} fill="url(#ownerCardGradient)" />
        </Svg>
      ) : null}

      <View style={styles.content}>
        <View style={styles.topRow}>
          <Text style={styles.label}>ВЛАДЕЛЕЦ</Text>
          <Text style={styles.crown}>👑</Text>
        </View>
        <Text style={styles.name} numberOfLines={1}>
          {displayName}
        </Text>
        <Text style={styles.username} numberOfLines={1}>
          @{username}
        </Text>
        <View style={styles.bottomRow}>
          <Text style={styles.balance}>Баланс: ∞</Text>
          <Text style={styles.serial}>{ownerSerial(userId)}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.gold,
    backgroundColor: '#2A2140',
    overflow: 'hidden',
    padding: 16,
  },
  content: {
    gap: 2,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    color: colors.gold,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 3,
  },
  crown: {
    fontSize: 16,
  },
  name: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    marginTop: 10,
  },
  username: {
    color: 'rgba(236,236,239,0.65)',
    fontSize: 13,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  balance: {
    color: colors.gold,
    fontSize: 15,
    fontWeight: '700',
  },
  serial: {
    color: 'rgba(236,236,239,0.55)',
    fontSize: 12,
    letterSpacing: 1.5,
  },
});
