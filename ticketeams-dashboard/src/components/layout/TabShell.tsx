import type { TabKey } from '../../types/api';
import HomeTab from '../home/HomeTab';
import ScoutTab from '../scout/ScoutTab';
import CMOTab from '../cmo/CMOTab';
import CreativeTab from '../creative/CreativeTab';
import IntelligenceTab from '../intelligence/IntelligenceTab';
import FinanceTab from '../finance/FinanceTab';
import MetaTab from '../meta/MetaTab';
import OrchestratorTab from '../orchestrator/OrchestratorTab';
import SEOTab from '../seo/SEOTab';

interface Props {
  activeTab: TabKey;
}

export default function TabShell({ activeTab }: Props) {
  return (
    <main className="px-6 py-5 max-w-[1440px] mx-auto mobile-px">
      <div key={activeTab} className="tab-content">
        {activeTab === 'home' && <HomeTab />}
        {activeTab === 'scout' && <ScoutTab />}
        {activeTab === 'cmo' && <CMOTab />}
        {activeTab === 'creative' && <CreativeTab />}
        {activeTab === 'intelligence' && <IntelligenceTab />}
        {activeTab === 'finance' && <FinanceTab />}
        {activeTab === 'meta' && <MetaTab />}
        {activeTab === 'orchestrator' && <OrchestratorTab />}
        {activeTab === 'seo' && <SEOTab />}
      </div>
    </main>
  );
}
