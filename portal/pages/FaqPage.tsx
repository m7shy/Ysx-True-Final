import React from 'react';
import { motion } from 'motion/react';
import { ChevronDown, Mail, Clock3 } from 'lucide-react';
import { Card, Spinner, Alert, Eyebrow } from '@/src/design/ui';
import { blurIn } from '@/src/design/motion';
import { fetchFaq, type FaqItem, type ContactInfo } from '../services/portalApi';

export const FaqPage: React.FC = () => {
  const [data, setData] = React.useState<{ faq: FaqItem[]; contact: ContactInfo } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState<number | null>(0);

  React.useEffect(() => {
    fetchFaq().then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <Alert variant="error">{error}</Alert>;
  if (!data)
    return (
      <div className="flex justify-center py-24">
        <Spinner className="h-6 w-6 text-volt-text" />
      </div>
    );

  return (
    <motion.div {...blurIn} className="mx-auto max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Help & contact</h1>
        <p className="mt-1 text-sm text-neutral-400">Quick answers first — and a direct line if you need us.</p>
      </div>

      <div className="mb-8 space-y-2">
        {data.faq.map((item, i) => (
          <Card key={i} padding="none">
            <button
              onClick={() => setOpen(open === i ? null : i)}
              aria-expanded={open === i}
              className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
            >
              <span className="text-sm font-medium text-white">{item.q}</span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-neutral-500 transition-transform duration-300 ${
                  open === i ? 'rotate-180' : ''
                }`}
              />
            </button>
            {open === i && (
              <p className="px-5 pb-4 text-sm leading-relaxed text-neutral-400">{item.a}</p>
            )}
          </Card>
        ))}
      </div>

      <Card padding="lg">
        <Eyebrow className="mb-3">Still need us?</Eyebrow>
        <div className="space-y-2 text-sm">
          <a
            href={`mailto:${data.contact.email}`}
            className="inline-flex items-center gap-2 text-white hover:text-volt-text transition-colors"
          >
            <Mail className="h-4 w-4 text-volt-text" /> {data.contact.email}
          </a>
          <p className="flex items-center gap-2 text-neutral-400">
            <Clock3 className="h-4 w-4 text-neutral-500" /> {data.contact.officeHours}
          </p>
          <p className="text-xs text-neutral-600">{data.contact.responseTime}</p>
        </div>
      </Card>
    </motion.div>
  );
};
