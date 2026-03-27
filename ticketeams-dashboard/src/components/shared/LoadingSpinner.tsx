export default function LoadingSpinner({ text = 'טוען...' }: { text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-text-dim">
      <div className="bg-card border border-border rounded-2xl p-8 card-elevated flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-[3px] border-border border-t-pink rounded-full animate-spin" />
        <p className="text-sm font-medium">{text}</p>
      </div>
    </div>
  );
}
