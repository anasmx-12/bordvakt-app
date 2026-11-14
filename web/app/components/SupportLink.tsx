import Link from 'next/link';
import { LifeBuoy } from 'lucide-react';
import { SupportTopic } from '@/lib/supportTopics';

/** "Behöver ni hjälp på plats? Kontakta Bordvakt support" – för steg som görs i restaurangen. */
export default function SupportLink({ topic, children }: { topic: SupportTopic; children?: React.ReactNode }) {
  return (
    <Link
      href={`/setup/support?topic=${topic}`}
      className="group flex items-center gap-2.5 rounded-lg border border-dashed border-line bg-paper px-3 py-2.5 text-sm text-body hover:border-ink hover:text-ink"
    >
      <LifeBuoy className="h-4 w-4 flex-none text-accent" />
      <span>
        {children ?? 'Behöver ni hjälp på plats?'} <span className="font-semibold underline-offset-2 group-hover:underline">Kontakta Bordvakt support</span>
      </span>
    </Link>
  );
}
