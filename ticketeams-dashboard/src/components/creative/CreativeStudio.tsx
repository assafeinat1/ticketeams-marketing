import { useState, useCallback } from 'react';
import { getPendingApprovals, approveVersion, updateAdText, regenerateVersion } from '../../api/creative';
import { publishCampaign } from '../../api/meta';
import type { PendingApproval } from '../../types/api';
import { usePolling } from '../../hooks/usePolling';
import { useToast } from '../../hooks/useToast';
import StatCard from '../shared/StatCard';
import SkeletonLoader from '../shared/SkeletonLoader';
import StatusBadge from '../shared/StatusBadge';
import ImageCarousel from './ImageCarousel';
import EditableAdCard from './EditableAdCard';
import ApprovalPipeline from './ApprovalPipeline';
import CreativeGallery from './CreativeGallery';
import StyleMemoryPanel from './StyleMemoryPanel';
import Dialog from '../ui/Dialog';
import AgentChat from '../chat/AgentChat';

export default function CreativeStudio() {
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState<string | null>(null);
  const { showToast } = useToast();

  const loadApprovals = useCallback(async () => {
    try {
      const data = await getPendingApprovals();
      setApprovals(data);
    } catch {
      // Backend may not be running
    } finally {
      setLoading(false);
    }
  }, []);

  usePolling(loadApprovals, 30000);

  const handleApprove = async (matchKey: string, versionIndex: number) => {
    try {
      const result = await approveVersion(matchKey, versionIndex);
      const p = result.pipeline;
      const parts = [`גרסה ${versionIndex} אושרה`];
      if (p?.finance?.status === 'ok') parts.push('תקציב ✓');
      if (p?.meta?.status === 'ok') parts.push('Meta ✓');
      showToast('success', parts.join(' | '));
      await loadApprovals();
    } catch {
      showToast('error', 'שגיאה באישור הגרסה');
    }
  };

  const handlePublish = async (matchKey: string) => {
    setPublishing(matchKey);
    try {
      await publishCampaign(matchKey);
      showToast('success', 'קמפיין נשלח לפרסום (PAUSED)');
      await loadApprovals();
    } catch {
      showToast('error', 'שגיאה בפרסום הקמפיין');
    } finally {
      setPublishing(null);
    }
  };

  if (loading) return (
    <div className="space-y-5">
      <div className="skeleton h-6 w-48" />
      <SkeletonLoader type="cards" cols={3} />
      <SkeletonLoader type="chart" />
    </div>
  );

  const pending = approvals.filter(a => a.status === 'ממתין לאישור');
  const approved = approvals.filter(a => a.status === 'אושר');

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">סטודיו קריאייטיב</h2>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 max-w-lg stat-grid-responsive">
        <StatCard label="ממתינות" value={pending.length} color="orange" />
        <StatCard label="אושרו" value={approved.length} color="green" />
        <StatCard label="סה״כ" value={approvals.length} color="purple" />
      </div>

      {/* Split Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left Panel — 60% */}
        <div className="lg:col-span-3 space-y-4">
          {/* AI Chat */}
          <AgentChat agent="creative" />

          {/* Pending Approvals */}
          {pending.map((approval) => (
            <MatchApprovalCard
              key={approval.matchKey}
              approval={approval}
              onApprove={handleApprove}
              onReload={loadApprovals}
              onPublish={handlePublish}
              publishing={publishing === approval.matchKey}
            />
          ))}

          {/* Approved */}
          {approved.map((approval) => (
            <MatchApprovalCard
              key={approval.matchKey}
              approval={approval}
              onApprove={handleApprove}
              onReload={loadApprovals}
              onPublish={handlePublish}
              publishing={publishing === approval.matchKey}
            />
          ))}

          {approvals.length === 0 && (
            <div className="bg-card border border-border rounded-2xl p-10 text-center card-elevated">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-orange/15 to-purple/15 flex items-center justify-center">
                <span className="text-4xl">🎨</span>
              </div>
              <p className="text-base text-text-dim">אין מודעות ממתינות — המערכת תיצור אוטומטית כשתגיע בקשה</p>
            </div>
          )}
        </div>

        {/* Right Panel — 40% */}
        <div className="lg:col-span-2 space-y-4">
          <CreativeGallery />
          <StyleMemoryPanel />
        </div>
      </div>
    </div>
  );
}

// ============================================================
// MatchApprovalCard — single match with carousel + editable cards + pipeline
// ============================================================

function MatchApprovalCard({
  approval,
  onApprove,
  onReload,
  onPublish,
  publishing,
}: {
  approval: PendingApproval;
  onApprove: (matchKey: string, version: number) => void;
  onReload: () => void;
  onPublish: (matchKey: string) => void;
  publishing: boolean;
}) {
  const { showToast } = useToast();
  const [regenerateTarget, setRegenerateTarget] = useState<number | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  const isApproved = approval.status === 'אושר';
  const matchName = approval.matchKey.replace(/__/g, ' | ').replace(/_/g, ' ');

  const handleSave = async (versionIndex: number, updates: { headline: string; body: string; cta: string }) => {
    try {
      await updateAdText(approval.matchKey, versionIndex, updates);
      showToast('success', 'שינויים נשמרו');
      onReload();
    } catch {
      showToast('error', 'שגיאה בשמירת שינויים');
    }
  };

  const handleRegenerate = async () => {
    if (regenerateTarget === null) return;
    setRegenerating(true);
    try {
      await regenerateVersion(approval.matchKey, regenerateTarget);
      showToast('success', `גרסה ${regenerateTarget} נוצרה מחדש`);
      onReload();
    } catch {
      showToast('error', 'שגיאה ביצירת גרסה חדשה');
    } finally {
      setRegenerating(false);
      setRegenerateTarget(null);
    }
  };

  return (
    <>
      <div className={`bg-card border rounded-xl overflow-hidden card-elevated transition-all ${isApproved ? 'border-green/30' : 'border-border hover:border-border'}`}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-center justify-between bg-bg-elevated/30">
          <div>
            <h3 className="font-bold text-lg">{matchName}</h3>
            <p className="text-xs text-text-dim mt-1">
              {new Date(approval.createdAt).toLocaleDateString('he-IL')}
            </p>
          </div>
          <StatusBadge status={isApproved ? 'approved' : 'pending'} size="md" />
        </div>

        {/* Image Carousel */}
        <div className="px-5 pt-4">
          <ImageCarousel versions={approval.versions} />
        </div>

        {/* Editable Versions Grid */}
        <div className="grid grid-cols-3 gap-4 p-5 mobile-stack">
          {approval.versions.map((version) => (
            <EditableAdCard
              key={version.index}
              version={version}
              isApproved={isApproved}
              isSelected={isApproved && approval.selectedVersion === version.index}
              onSave={(updates) => handleSave(version.index, updates)}
              onApprove={() => onApprove(approval.matchKey, version.index)}
              onRegenerate={() => setRegenerateTarget(version.index)}
            />
          ))}
        </div>

        {/* Pipeline — show for approved items */}
        {isApproved && (
          <div className="px-5 pb-5">
            <ApprovalPipeline
              approval={approval}
              onPublish={onPublish}
              publishing={publishing}
            />
          </div>
        )}
      </div>

      {/* Regenerate Confirmation Dialog */}
      <Dialog
        open={regenerateTarget !== null}
        onOpenChange={(open) => { if (!open) setRegenerateTarget(null); }}
        title="יצירת גרסה חדשה"
        description={`האם ליצור מחדש גרסה ${regenerateTarget}? הטקסט הנוכחי יוחלף בגרסה חדשה מה-AI.`}
        confirmLabel={regenerating ? 'יוצר...' : 'צור מחדש'}
        onConfirm={handleRegenerate}
      />
    </>
  );
}
