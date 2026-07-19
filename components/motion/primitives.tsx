import React from 'react';
import { motion, useReducedMotion, type Variants } from 'motion/react';
import {
  EASE,
  staggerDelay,
  blurIn,
  STAGGER,
  VIEWPORT,
} from '../../src/design/motion';

/**
 * Signature keynote ease + stagger helpers now live in the shared design
 * system (src/design/motion.ts). Re-exported here for back-compat so existing
 * `import { EASE, staggerDelay } from './primitives'` call sites keep working.
 */
export { EASE, staggerDelay, blurIn, STAGGER, VIEWPORT };

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
export const ViewTransition: React.FC<ViewTransitionProps> = ({ className, children }) => {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12, filter: 'blur(6px)' }}
      animate={
        reduce
          ? { opacity: 1, transition: { duration: 0.2 } }
          : { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.45, ease: EASE } }
      }
      exit={
        reduce
          ? { opacity: 0, transition: { duration: 0.12 } }
          : { opacity: 0, y: -8, filter: 'blur(4px)', transition: { duration: 0.18, ease: 'easeIn' } }
      }
      className={className ?? 'flex-1 flex flex-col min-h-0 overflow-hidden'}
    >
      {children}
    </motion.div>
  );
};
