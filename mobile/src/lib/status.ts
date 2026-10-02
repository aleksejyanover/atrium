import { colors } from '@/lib/theme';
import {
  ApplicationStatus,
  DismissalStatus,
  DocumentStatus,
} from '@/lib/types';

/** Статусы заявлений на вступление (SPEC v2 §14.3). */
export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  pending: 'На рассмотрении',
  approved: 'Принято',
  rejected: 'Отклонено',
  canceled: 'Отозвано',
};

/** Статусы договора об увольнении (SPEC v2 §10). */
export const DISMISSAL_STATUS_LABELS: Record<DismissalStatus, string> = {
  pending: 'Ожидает подписи',
  signed: 'Подписан',
  rejected: 'Оспорен',
  canceled: 'Отменён',
  terminated: 'Расторгнут',
};

export function applicationStatusLabel(status: string): string {
  return APPLICATION_STATUS_LABELS[status as ApplicationStatus] ?? status;
}

export function dismissalStatusLabel(status: string): string {
  return DISMISSAL_STATUS_LABELS[status as DismissalStatus] ?? status;
}

export function documentStatusLabel(document: { type: string; status: string }): string {
  return document.type === 'join_application'
    ? applicationStatusLabel(document.status)
    : dismissalStatusLabel(document.status);
}

/** Цвет статуса для бейджей (тёмные токены §1). */
export function statusColor(status: DocumentStatus | string): string {
  switch (status) {
    case 'pending':
      return colors.accent;
    case 'approved':
    case 'signed':
      return colors.ok;
    case 'rejected':
    case 'terminated':
      return colors.danger;
    default:
      return colors.muted;
  }
}
