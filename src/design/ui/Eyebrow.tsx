import React from 'react';

export interface EyebrowProps extends React.HTMLAttributes<HTMLParagraphElement> {}

/** Uppercase volt-text kicker above headlines. */
export const Eyebrow: React.FC<EyebrowProps> = ({
  className = '',
  children,
  ...rest
}) => (
  <p
    className={`text-xs uppercase tracking-[0.35em] text-volt-text font-medium ${className}`}
    {...rest}
  >
    {children}
  </p>
);

export default Eyebrow;
