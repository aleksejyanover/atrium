import { Feather } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { RoleBadge } from '@/components/avatar';
import { ROLE_MATRIX, ROLE_RANK, ROLES_DESC } from '@/lib/roles';
import { colors, radius } from '@/lib/theme';
import { Role } from '@/lib/types';

/**
 * «Роли и права» (SPEC §19) — компактные карточки по ролям,
 * текущая роль подсвечена рамкой и бейджем «ваша роль».
 */
export function RolesMatrix({ currentRole }: { currentRole: Role }) {
  return (
    <View style={styles.list}>
      {ROLES_DESC.map((role) => {
        const current = role === currentRole;
        return (
          <View key={role} style={[styles.card, current && styles.cardCurrent]}>
            <View style={styles.cardHeader}>
              <RoleBadge role={role} />
              <Text style={styles.rank}>ранг {ROLE_RANK[role]}</Text>
              {current ? (
                <View style={styles.youChip}>
                  <Text style={styles.youText}>ваша роль</Text>
                </View>
              ) : null}
            </View>
            {ROLE_MATRIX.map((row) => {
              const allowed = row.allowed[role];
              return (
                <View key={row.key} style={styles.actionRow}>
                  <Feather
                    name={allowed ? 'check' : 'x'}
                    size={14}
                    color={allowed ? colors.ok : colors.muted}
                    style={{ opacity: allowed ? 1 : 0.5 }}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.actionLabel, !allowed && styles.actionDenied]}>
                      {row.label}
                    </Text>
                    {row.note && allowed ? <Text style={styles.note}>{row.note}</Text> : null}
                  </View>
                </View>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 12,
  },
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: 14,
    gap: 7,
  },
  cardCurrent: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(124,108,246,0.07)',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 3,
    flexWrap: 'wrap',
  },
  rank: {
    color: colors.muted,
    fontSize: 11,
    flex: 1,
  },
  youChip: {
    backgroundColor: 'rgba(124,108,246,0.18)',
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  youText: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '600',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  actionLabel: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
  },
  actionDenied: {
    color: colors.muted,
  },
  note: {
    color: colors.muted,
    fontSize: 11,
    marginTop: 1,
  },
});
