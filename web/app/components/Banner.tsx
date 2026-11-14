import { AlertTriangle, CameraOff, Info } from 'lucide-react';

const TONES = {
  warning: { box: 'border-[#F3C9B0] bg-[#FDF1EA] text-[#7C2D12]', icon: AlertTriangle, iconColor: 'text-accent' },
  camera: { box: 'border-gray-300 bg-gray-50 text-gray-700', icon: CameraOff, iconColor: 'text-gray-600' },
  info: { box: 'border-[#B9DAD4] bg-teal-light text-[#134E48]', icon: Info, iconColor: 'text-teal' },
} as const;

interface Props {
  tone?: keyof typeof TONES;
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  role?: 'alert' | 'status';
}

/** Meddelanderuta med ikon, t.ex. "Kameran ser inte bord 3". */
export default function Banner({ tone = 'warning', title, children, action, role }: Props) {
  const t = TONES[tone];
  const Icon = t.icon;
  return (
    <div role={role} className={`animate-rise flex items-start gap-3 rounded-lg border px-3.5 py-3 text-sm ${t.box}`}>
      <Icon className={`mt-0.5 h-[18px] w-[18px] flex-none ${t.iconColor}`} strokeWidth={2} />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold text-ink">{title}</p>}
        {children && <div className={title ? 'mt-0.5' : ''}>{children}</div>}
      </div>
      {action && <div className="flex-none">{action}</div>}
    </div>
  );
}
