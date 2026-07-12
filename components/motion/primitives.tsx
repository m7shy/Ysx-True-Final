import React from 'react';
import { motion, type Variants } from 'motion/react';

/** Signature keynote ease used by every entrance in the app. */
export const EASE = [0.22, 1, 0.36, 1] as const;

/** Cap stagger delays so long lists (200+ rows) appear near-instantly. */
export const staggerDelay = (index: number, step = 0.05, cap = 15) =>
  Math.min(index, cap) * step;

interface AnimatedHeadingProps {
  as?: 'h1' | 'h2' | 'h3';
  className?: string;
  delay?: number;
  children: React.ReactNode;
}

/** Heading that enters de-blurring and rising. */
export const AnimatedHeading: React.FC<AnimatedHeadingProps> = ({
  as = 'h2',
  className,
  delay = 0,
  children,
}) => {
  const Tag = motion[as];
  return (
    <Tag
      initial={{ opacity: 0, y: 30, filter: 'blur(12px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{ duration: 0.9, ease: EASE, delay }}
      className={className}
    >
      {children}
    </Tag>
  );
};

export const staggerContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } },
};

interface StaggerProps {
  className?: string;
  children: React.ReactNode;
}

/** Container that staggers each StaggerItem child by 0.05s. */
export const Stagger: React.FC<StaggerProps> = ({ className, children }) => (
  <motion.div variants={staggerContainer} initial="hidden" animate="show" className={className}>
    {children}
  </motion.div>
);

export const StaggerItem: React.FC<StaggerProps & Record<string, any>> = ({
  className,
  children,
  ...rest
}) => (
  <motion.div variants={staggerItem} className={className} {...rest}>
    {children}
  </motion.div>
);

interface MaskedRevealProps {
  className?: string;
  delay?: number;
  children: React.ReactNode;
}

/** Dense data panels unmask from the bottom. */
export const MaskedReveal: React.FC<MaskedRevealProps> = ({ className, delay = 0, children }) => (
  <motion.div
    initial={{ clipPath: 'inset(100% 0 0 0)', opacity: 0 }}
    animate={{ clipPath: 'inset(0% 0 0 0)', opacity: 1 }}
    transition={{ duration: 0.8, ease: EASE, delay }}
    className={className}
  >
    {children}
  </motion.div>
);

interface ViewTransitionProps {
  className?: string;
  children: React.ReactNode;
}

/** Per-view wrapper under <AnimatePresence mode="wait">; fast exit to avoid blank gaps. */
export const ViewTransition: React.FC<ViewTransitionProps> = ({ className, children }) => (
  <motion.div
    initial={{ opacity: 0, y: 12, filter: 'blur(6px)' }}
    animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.45, ease: EASE } }}
    exit={{ opacity: 0, y: -8, filter: 'blur(4px)', transition: { duration: 0.18, ease: 'easeIn' } }}
    className={className ?? 'flex-1 flex flex-col min-h-0 overflow-hidden'}
  >
    {children}
  </motion.div>
);
