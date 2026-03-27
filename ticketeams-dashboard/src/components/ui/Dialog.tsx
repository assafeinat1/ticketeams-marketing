import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import GradientButton from '../shared/GradientButton';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  variant?: 'primary' | 'danger';
  children?: ReactNode;
}

export default function Dialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'אישור',
  cancelLabel = 'ביטול',
  onConfirm,
  variant = 'primary',
  children,
}: Props) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 bg-black/70 z-50 animate-[fadeIn_200ms]" />
        <DialogPrimitive.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-card border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl animate-[scaleIn_200ms]">
          <DialogPrimitive.Title className="text-lg font-bold mb-2">
            {title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="text-sm text-text-dim mb-6">
            {description}
          </DialogPrimitive.Description>
          {children}
          <div className="flex gap-3 justify-end mt-6">
            <DialogPrimitive.Close asChild>
              <GradientButton variant="ghost">{cancelLabel}</GradientButton>
            </DialogPrimitive.Close>
            <GradientButton
              variant={variant === 'danger' ? 'danger' : 'primary'}
              onClick={() => {
                onConfirm();
                onOpenChange(false);
              }}
            >
              {confirmLabel}
            </GradientButton>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
