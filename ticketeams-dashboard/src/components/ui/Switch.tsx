import * as SwitchPrimitive from '@radix-ui/react-switch';

interface Props {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
}

export default function Switch({ checked, onCheckedChange, disabled = false, label }: Props) {
  return (
    <div className="flex items-center gap-3">
      <SwitchPrimitive.Root
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="w-11 h-6 rounded-full relative transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed data-[state=checked]:bg-green data-[state=unchecked]:bg-border"
      >
        <SwitchPrimitive.Thumb className="block w-5 h-5 bg-white rounded-full transition-transform data-[state=checked]:translate-x-[-22px] data-[state=unchecked]:translate-x-[-2px] shadow-md" />
      </SwitchPrimitive.Root>
      {label && <span className="text-sm text-text-dim">{label}</span>}
    </div>
  );
}
