import { useState, useCallback, type ButtonHTMLAttributes } from 'react';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'danger' | 'ghost';
  animateOnClick?: 'approve' | 'reject';
}

export default function GradientButton({ variant = 'primary', children, className = '', animateOnClick, onClick, ...props }: Props) {
  const [animClass, setAnimClass] = useState('');

  const styles = {
    primary: 'bg-gradient-to-l from-pink via-orange to-purple text-white hover:opacity-90 shadow-lg shadow-pink/10',
    danger: 'bg-red/10 text-red border border-red/20 hover:bg-red/20',
    ghost: 'bg-card border border-border text-text-dim hover:text-text hover:border-text-dim',
  };

  const handleClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    if (animateOnClick) {
      const cls = animateOnClick === 'approve' ? 'approve-flash' : 'reject-shake';
      setAnimClass(cls);
      setTimeout(() => setAnimClass(''), 450);
    }
    onClick?.(e);
  }, [animateOnClick, onClick]);

  return (
    <button
      className={`px-4 py-2 rounded-xl font-medium text-sm transition-all cursor-pointer ${styles[variant]} ${animClass} ${className}`}
      onClick={handleClick}
      {...props}
    >
      {children}
    </button>
  );
}
