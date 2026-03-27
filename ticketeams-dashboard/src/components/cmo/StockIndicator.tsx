import { useState, useEffect } from 'react';
import { getStockStatus } from '../../api/cmo';
import type { StockData } from '../../types/api';
import Tooltip from '../ui/Tooltip';

interface Props {
  matchKey?: string;
}

function deriveVisual(stock: StockData | null): { dot: string; label: string; tooltip: string } {
  if (!stock || stock.status === 'unavailable') {
    return { dot: 'bg-text-dim', label: 'מלאי לא זמין', tooltip: 'לא מחובר למלאי' };
  }
  if (stock.status === 'out_of_stock' || stock.inStockCategories === 0) {
    return { dot: 'bg-red', label: 'אזל המלאי', tooltip: `0/${stock.totalCategories} קטגוריות זמינות` };
  }

  const qty = stock.quantity;

  // Quantity-based thresholds: Red <10, Orange <50, Green >=50
  if (qty !== null && qty !== undefined) {
    if (qty < 10) {
      return {
        dot: 'bg-red animate-pulse',
        label: `${qty} כרטיסים — דחיפות!`,
        tooltip: `${stock.inStockCategories}/${stock.totalCategories} קטגוריות | ${qty} כרטיסים`,
      };
    }
    if (qty < 50) {
      return {
        dot: 'bg-orange',
        label: `${qty} כרטיסים — מלאי נמוך`,
        tooltip: `${stock.inStockCategories}/${stock.totalCategories} קטגוריות | ${qty} כרטיסים`,
      };
    }
    return {
      dot: 'bg-green',
      label: `${qty} כרטיסים — מלאי זמין`,
      tooltip: `${stock.inStockCategories}/${stock.totalCategories} קטגוריות | ${qty} כרטיסים`,
    };
  }

  // No quantity data but categories are in stock
  if (stock.status === 'low_stock') {
    return { dot: 'bg-orange', label: 'מלאי נמוך', tooltip: `${stock.inStockCategories}/${stock.totalCategories} קטגוריות זמינות` };
  }
  return { dot: 'bg-green', label: 'מלאי זמין', tooltip: `${stock.inStockCategories}/${stock.totalCategories} קטגוריות זמינות` };
}

export default function StockIndicator({ matchKey }: Props) {
  const [stock, setStock] = useState<StockData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!matchKey) return;
    setLoading(true);
    getStockStatus(matchKey)
      .then(setStock)
      .catch(() => setStock(null))
      .finally(() => setLoading(false));
  }, [matchKey]);

  if (loading) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-text-dim">
        <span className="w-3 h-3 border-2 border-text-dim/30 border-t-text-dim rounded-full animate-spin" />
        בודק מלאי...
      </span>
    );
  }

  const visual = deriveVisual(stock);

  return (
    <Tooltip content={visual.tooltip}>
      <span className="inline-flex items-center gap-1.5 text-xs text-text-dim cursor-default">
        <span className={`w-2 h-2 rounded-full ${visual.dot}`} />
        {visual.label}
      </span>
    </Tooltip>
  );
}
