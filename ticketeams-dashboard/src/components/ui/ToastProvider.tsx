import { createContext, useCallback, useState, type ReactNode } from 'react';
import * as ToastPrimitive from '@radix-ui/react-toast';

export type ToastType = 'success' | 'error' | 'info';

interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  showToast: (type: ToastType, message: string) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

export default function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback((type: ToastType, message: string) => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, type, message }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const borderColors: Record<ToastType, string> = {
    success: 'border-green/60',
    error: 'border-red/60',
    info: 'border-purple/60',
  };

  const dotColors: Record<ToastType, string> = {
    success: 'bg-green',
    error: 'bg-red',
    info: 'bg-purple',
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      <ToastPrimitive.Provider duration={4000}>
        {children}
        {toasts.map((toast) => (
          <ToastPrimitive.Root
            key={toast.id}
            className={`bg-card border ${borderColors[toast.type]} rounded-xl px-5 py-3 shadow-2xl flex items-center gap-3 data-[state=open]:animate-[slideInFromRight_250ms] data-[state=closed]:animate-[fadeOut_150ms]`}
            onOpenChange={(open) => {
              if (!open) removeToast(toast.id);
            }}
          >
            <span className={`w-2 h-2 rounded-full ${dotColors[toast.type]} shrink-0`} />
            <ToastPrimitive.Description className="text-sm text-text">
              {toast.message}
            </ToastPrimitive.Description>
          </ToastPrimitive.Root>
        ))}
        <ToastPrimitive.Viewport className="fixed top-5 right-5 z-[9999] flex flex-col gap-2 w-full max-w-sm" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}
