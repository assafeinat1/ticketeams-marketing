import { useState } from 'react';
import Switch from '../ui/Switch';
import Dialog from '../ui/Dialog';
import { publishCampaign } from '../../api/meta';
import { useToast } from '../../hooks/useToast';

interface Props {
  matchKey: string;
}

export default function PublishToggle({ matchKey }: Props) {
  const [published, setPublished] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const { showToast } = useToast();

  const handleToggle = (checked: boolean) => {
    if (checked) {
      setShowConfirm(true);
    } else {
      setPublished(false);
    }
  };

  const handlePublish = async () => {
    setPublishing(true);
    try {
      const result = await publishCampaign(matchKey);
      if (result.success) {
        setPublished(true);
        showToast('success', 'הקמפיין פורסם בהצלחה');
      } else {
        showToast('error', result.error || 'שגיאה בפרסום');
      }
    } catch {
      showToast('error', 'שגיאה בפרסום הקמפיין');
    } finally {
      setPublishing(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-4 bg-card border border-border rounded-xl p-4">
        <Switch
          checked={published}
          onCheckedChange={handleToggle}
          disabled={publishing}
          label={published ? 'פורסם' : 'טיוטה'}
        />
        <div className="flex-1">
          <p className="text-sm font-medium">
            {published ? 'הקמפיין פעיל במטא' : 'פרסם קמפיין למטא'}
          </p>
          <p className="text-xs text-text-dim">
            {published
              ? 'הקמפיין נשלח ל-Meta Ads Manager'
              : 'הפעל את המתג כדי לפרסם את המודעה המאושרת'}
          </p>
        </div>
        {published && (
          <span className="text-xs px-2 py-1 bg-green/10 text-green border border-green/30 rounded-lg">
            LIVE
          </span>
        )}
      </div>

      <Dialog
        open={showConfirm}
        onOpenChange={setShowConfirm}
        title="פרסום קמפיין"
        description="האם לפרסם את הקמפיין למטא? המודעה תפורסם ב-Facebook ו-Instagram."
        confirmLabel={publishing ? 'מפרסם...' : 'פרסם עכשיו'}
        onConfirm={handlePublish}
      />
    </>
  );
}
