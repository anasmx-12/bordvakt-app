'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Order, orderSummary, Task, TASK_STYLE, TaskType } from './types';
import { getSettings, updateSettings, useSettings } from './settings';
import { translate, translateIssue } from './i18n';
import { sosSummary } from './sos';

export interface AlertToast {
  id: string;
  tableId: string;
  tableNumber: number | null;
  text: string;
  detail: string;
  chip: string;
  /** Akut läge (SOS): rutan är röd och ligger kvar tills den stängs */
  urgent?: boolean;
}

type Sound = 'alert' | 'soft' | 'ready' | 'sos';

type Permission = NotificationPermission | 'unsupported';

const TOAST_MS = 10_000;
const MAX_TOASTS = 4;

/** Larmtexterna skrivs på enhetens valda språk (läses när larmet kommer). */
const tr = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
  translate(getSettings().language, key, vars);

/** Text som "Bord 4 söker kontakt" */
export const alertText = (type: TaskType, tableNumber: number | null) =>
  tr(`task.${type}`, { n: tableNumber ?? '?' });

/** Larm till personalen när nya uppgifter kommer in:
 *  ruta på skärmen, ljud, vibration och systemnotis när appen ligger i bakgrunden. */
export function useStaffAlerts() {
  const [toasts, setToasts] = useState<AlertToast[]>([]);
  const { sound: soundOn } = useSettings();
  const [permission, setPermission] = useState<Permission>('default');
  const audioRef = useRef<AudioContext | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  // Läs sparade inställningar (finns bara i webbläsaren)
  useEffect(() => {
    const t = setTimeout(() => {
      setPermission('Notification' in window ? Notification.permission : 'unsupported');
    }, 0);
    return () => clearTimeout(t);
  }, []);

  // Webbläsare tillåter bara ljud efter att användaren har tryckt någonstans
  useEffect(() => {
    const unlock = () => {
      audioRef.current ??= new AudioContext();
      audioRef.current.resume();
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  useEffect(() => {
    const all = timers.current;
    return () => all.forEach(clearTimeout);
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
  }, []);

  const playSound = useCallback((sound: Sound) => {
    const ctx = audioRef.current;
    if (!ctx || ctx.state !== 'running') return;
    // Röda larm: två snabba höga toner. Dessert: en mjuk ton. Mat klar: tre stigande toner.
    // SOS: hög-låg-sirén tre gånger, starkare och skarpare än de andra.
    const sos = sound === 'sos';
    const notes = sos
      ? [1320, 880, 1320, 880, 1320, 880]
      : sound === 'soft' ? [660] : sound === 'ready' ? [523, 659, 784] : [880, 1175];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = ctx.currentTime + i * 0.18;
      osc.frequency.value = freq;
      osc.type = sos ? 'square' : 'sine';
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(sos ? 0.2 : 0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.18);
    });
  }, []);

  const show = useCallback(
    (toast: AlertToast, sound: Sound, vibrate: boolean) => {
      setToasts((prev) => [toast, ...prev.filter((t) => t.id !== toast.id)].slice(0, MAX_TOASTS));
      clearTimeout(timers.current.get(toast.id));
      // SOS-rutan ligger kvar tills någon stänger den
      if (!toast.urgent) timers.current.set(toast.id, setTimeout(() => dismiss(toast.id), TOAST_MS));

      const settings = getSettings();
      if (settings.sound) playSound(sound);
      if (vibrate && settings.vibration) {
        navigator.vibrate?.(toast.urgent ? [400, 120, 400, 120, 400] : [180, 80, 180]);
      }

      // Systemnotis bara när appen inte syns (annars räcker rutan på skärmen)
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification(toast.text, { body: toast.detail, tag: toast.id, requireInteraction: toast.urgent });
        } catch {
          // Vissa mobilwebbläsare kräver en service worker för notiser
        }
      }
    },
    [dismiss, playSound]
  );

  /** Anropas när en ny uppgift har kommit in via realtid. */
  const notify = useCallback(
    (task: Task, tableNumber: number | null) => {
      const sos = task.type === 'EMERGENCY';
      show(
        {
          id: task.id,
          tableId: task.table_id,
          tableNumber,
          text: alertText(task.type, tableNumber),
          detail: sos
            ? [sosSummary(task, (key) => tr(key)), tr('alert.sos')].filter(Boolean).join(' · ')
            : tr('alert.newTap'),
          chip: TASK_STYLE[task.type].chip,
          urgent: sos,
        },
        sos ? 'sos' : task.type === 'DESSERT' ? 'soft' : 'alert',
        task.type !== 'DESSERT'
      );
    },
    [show]
  );

  /** Anropas när köket har markerat en beställning som klar. */
  const notifyOrderReady = useCallback(
    (order: Order, tableNumber: number | null) =>
      show(
        {
          id: `order-${order.id}`,
          tableId: order.table_id,
          tableNumber,
          text: tr('alert.foodReady', { n: tableNumber ?? '?' }),
          detail: orderSummary(order, tr('order.empty')),
          chip: 'bg-teal text-white',
        },
        'ready',
        true
      ),
    [show]
  );

  /** En gäst har beställt via QR-koden (eller vill beställa och väntar på godkännande). */
  const notifyGuestOrder = useCallback(
    (order: Order, tableNumber: number | null) =>
      show(
        {
          id: `qr-${order.id}`,
          tableId: order.table_id,
          tableNumber,
          text: tr(order.status === 'PENDING_APPROVAL' ? 'alert.qrApprove' : 'alert.qrOrder', { n: tableNumber ?? '?' }),
          detail: orderSummary(order, tr('order.empty')),
          chip: 'bg-violet-700 text-white',
        },
        order.status === 'PENDING_APPROVAL' ? 'alert' : 'soft',
        order.status === 'PENDING_APPROVAL'
      ),
    [show]
  );

  /** Entré: ett bord som passar ett väntande sällskap har blivit ledigt. */
  const notifyTableFree = useCallback(
    (tableId: string, tableNumber: number, party: string, size: number) =>
      show(
        {
          id: `free-${tableId}`,
          tableId,
          tableNumber,
          text: tr('alert.tableFree', { n: tableNumber }),
          detail: tr('alert.tableFreeFor', { name: party, n: size }),
          chip: 'bg-teal text-white',
        },
        'alert',
        false
      ),
    [show]
  );

  const toggleSound = useCallback(() => {
    updateSettings({ sound: !getSettings().sound });
    audioRef.current ??= new AudioContext();
    audioRef.current.resume();
  }, []);

  const enableNotifications = useCallback(async () => {
    if (!('Notification' in window)) return;
    setPermission(await Notification.requestPermission());
  }, []);

  /** Ett bord har försvunnit ur kamerans bild. */
  const notifyCameraBlind = useCallback(
    (tableId: string, tableNumber: number, issue: string | null) =>
      show(
        {
          id: `blind-${tableId}`,
          tableId,
          tableNumber,
          text: tr('alert.blind', { n: tableNumber }),
          detail: translateIssue((key) => tr(key), issue) || tr('tasks.checkCamera'),
          chip: 'bg-gray-700 text-white',
        },
        'soft',
        false
      ),
    [show]
  );

  /** Spelar larmljudet en gång (knappen "Testa ljudet" i Inställningar). */
  const testSound = useCallback(() => {
    audioRef.current ??= new AudioContext();
    audioRef.current.resume().then(() => playSound('alert'));
    if (getSettings().vibration) navigator.vibrate?.([180, 80, 180]);
  }, [playSound]);

  return { toasts, notify, testSound, notifyOrderReady, notifyGuestOrder, notifyCameraBlind, notifyTableFree, dismiss, soundOn, toggleSound, permission, enableNotifications };
}
