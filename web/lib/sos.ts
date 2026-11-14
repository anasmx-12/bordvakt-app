import { Task } from './types';
import { TFunction } from './i18n';

/** "Tallrik med mat · Gästen böjer sig ned", eller tomt om AI:n inte sparat vad som hände. */
export function sosSummary(task: Pick<Task, 'sos_kind' | 'sos_trigger'>, t: TFunction): string {
  const parts = [
    task.sos_kind ? t(`sos.kind.${task.sos_kind}`) : null,
    task.sos_trigger ? t(`sos.why.${task.sos_trigger}`) : null,
  ];
  return parts.filter(Boolean).join(' · ');
}
