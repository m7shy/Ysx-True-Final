import React from 'react';

export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** add a volt glow + border lift on hover */
  hover?: boolean;
  padding?: CardPadding;
}

const PADDING: Record<CardPadding, string> = {
  none: '',
  sm: 'p-4',
  md: 'p-6',
  lg: 'p-8',
};

/** Surface panel: rounded-2xl, hairline border, faint translucent fill. */
export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ hover = false, padding = 'md', className = '', children, ...rest }, ref) => (
    <div
      ref={ref}
      className={`rounded-2xl border border-white/10 bg-white/[0.02] ${
        PADDING[padding]
      } ${
        hover
          ? 'transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:border-white/16 hover:bg-white/[0.04] hover:shadow-[0_0_20px_rgb(2_1_255/0.35)]'
          : ''
      } ${className}`}
      {...rest}
    >
      {children}
    </div>
  ),
);

Card.displayName = 'Card';

export default Card;
