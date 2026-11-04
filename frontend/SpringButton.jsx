import React from 'react';
import { motion } from 'motion/react';

const SpringButton = React.forwardRef(function SpringButton({ disabled, whileTap, whileHover, transition, ...props }, ref) {
  return (
    <motion.button
      ref={ref}
      disabled={disabled}
      whileTap={whileTap ?? (disabled ? undefined : { scale: 0.965, y: 1 })}
      whileHover={whileHover ?? (disabled ? undefined : { y: -1 })}
      transition={transition ?? { type: 'spring', stiffness: 480, damping: 26 }}
      {...props}
    />
  );
});

export default SpringButton;
