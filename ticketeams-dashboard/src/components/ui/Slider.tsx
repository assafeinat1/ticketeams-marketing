import * as SliderPrimitive from '@radix-ui/react-slider';

interface Props {
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
}

export default function Slider({
  value,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  className = '',
}: Props) {
  return (
    <SliderPrimitive.Root
      className={`relative flex items-center select-none touch-none h-5 w-full ${className}`}
      value={[value]}
      onValueChange={([v]) => onValueChange(v)}
      min={min}
      max={max}
      step={step}
      dir="rtl"
    >
      <SliderPrimitive.Track className="relative grow h-1.5 rounded-full bg-border">
        <SliderPrimitive.Range className="absolute h-full rounded-full bg-gradient-to-l from-pink to-orange" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="block w-5 h-5 rounded-full bg-pink border-2 border-bg shadow-lg cursor-grab active:cursor-grabbing focus:outline-none focus:ring-2 focus:ring-pink/40 transition-transform hover:scale-110" />
    </SliderPrimitive.Root>
  );
}
