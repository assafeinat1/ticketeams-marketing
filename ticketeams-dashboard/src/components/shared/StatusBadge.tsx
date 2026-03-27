interface Props {
  status: string;
  size?: 'sm' | 'md';
}

export default function StatusBadge({ status, size = 'sm' }: Props) {
  const styles: Record<string, string> = {
    critical: 'bg-red/20 text-red',
    high: 'bg-orange/20 text-orange',
    medium: 'bg-purple/20 text-purple',
    low: 'bg-text-dim/20 text-text-dim',
    approved: 'bg-green/20 text-green',
    pending: 'bg-orange/20 text-orange',
    pending_approval: 'bg-orange/20 text-orange',
    auto_executed: 'bg-green/20 text-green',
    logged: 'bg-blue/20 text-blue',
    Stadium: 'bg-purple/20 text-purple',
    Human: 'bg-pink/20 text-pink',
    Urgency: 'bg-orange/20 text-orange',
    CREATE_CAMPAIGN: 'bg-pink/20 text-pink',
    PAUSE_CAMPAIGN: 'bg-red/20 text-red',
    INCREASE_BUDGET: 'bg-green/20 text-green',
    REDUCE_BUDGET: 'bg-orange/20 text-orange',
    BOOST_CAMPAIGN: 'bg-purple/20 text-purple',
  };

  const sizeClass = size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-sm px-3 py-1';

  const labels: Record<string, string> = {
    pending: 'ממתין',
    pending_approval: 'ממתין לאישור',
    auto_executed: 'בוצע אוטומטית',
    approved: 'אושר',
    logged: 'נרשם',
    CREATE_CAMPAIGN: 'צור קמפיין',
    PAUSE_CAMPAIGN: 'השהה קמפיין',
    INCREASE_BUDGET: 'הגדל תקציב',
    REDUCE_BUDGET: 'הקטן תקציב',
    BOOST_CAMPAIGN: 'הגבר קמפיין',
  };

  return (
    <span className={`rounded-full font-medium ${sizeClass} ${styles[status] || 'bg-card text-text-dim'}`}>
      {labels[status] || status}
    </span>
  );
}
