import { useEffect, useRef, useState } from 'react';
import { useUIStore } from '../../stores/ui-store';

export interface DonutSlice {
  id: string;
  color: string;
  amount: number;
}

interface DonutChartProps {
  slices: DonutSlice[];
  totalExpense: number;
  totalIncome: number;
  categoriesViewType: 'EXPENSE' | 'INCOME';
}

const CX = 100;
const CY = 100;
const R = 80;
const CIRCUMFERENCE = 2 * Math.PI * R;
const STROKE_WIDTH = 8;
// Gap between slices in px (as fraction of circumference)
const GAP_PX = 2;

export function formatAmount(amount: number): string {
  const major = amount / 100;
  if (major >= 1_000_000) return `${(major / 1_000_000).toFixed(1)}M`;
  if (major >= 1_000) return `${(major / 1_000).toFixed(1)}k`;
  return major.toFixed(0);
}

export function dynamicFontSize(str: string, maxSize: number, minSize: number): number {
  const usableWidth = 120;
  const charWidthRatio = 0.6;
  const fitsAtMax = Math.floor(usableWidth / (charWidthRatio * maxSize));
  if (str.length <= fitsAtMax) return maxSize;
  const computed = Math.floor(usableWidth / (str.length * charWidthRatio));
  return Math.max(minSize, Math.min(maxSize, computed));
}

export function computeTextPositions(primaryFontSize: number, secondaryFontSize: number): { primaryY: number; secondaryY: number } {
  const lineHeightRatio = 1.2;
  const primaryLineHeight = primaryFontSize * lineHeightRatio;
  const secondaryLineHeight = secondaryFontSize * lineHeightRatio;
  const gap = 4;
  const primaryY = CY - gap / 2 - primaryLineHeight / 2;
  const secondaryY = CY + gap / 2 + secondaryLineHeight / 2;
  return { primaryY, secondaryY };
}

export default function DonutChart({ slices, totalExpense, totalIncome, categoriesViewType }: DonutChartProps) {
  const toggleCategoriesViewType = useUIStore((s) => s.toggleCategoriesViewType);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [animated, setAnimated] = useState(false);
  const animTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Trigger animation on mount or when slices change
  useEffect(() => {
    setAnimated(false);
    if (animTimerRef.current) clearTimeout(animTimerRef.current);
    animTimerRef.current = setTimeout(() => {
      setAnimated(true);
    }, 30);
    return () => {
      if (animTimerRef.current) clearTimeout(animTimerRef.current);
    };
  }, [slices.length]);

  const total = slices.reduce((sum, s) => sum + s.amount, 0);
  const isEmpty = total === 0 || slices.length === 0;

  function handleSliceClick(e: React.MouseEvent, index: number) {
    e.stopPropagation();
    setActiveIndex((prev) => (prev === index ? null : index));
  }

  function handleChartClick() {
    setActiveIndex(null);
    toggleCategoriesViewType();
  }

  if (isEmpty) {
    return (
      <div
        onClick={handleChartClick}
        style={{ display: 'flex', justifyContent: 'center', cursor: 'pointer', padding: 'var(--space-4) 0' }}
      >
        <svg
          viewBox="0 0 200 200"
          width="200"
          height="200"
          aria-label="No spending data"
          role="img"
        >
          <circle
            cx={CX}
            cy={CY}
            r={R}
            fill="none"
            stroke="var(--color-border)"
            strokeWidth={STROKE_WIDTH}
          />
          <text
            x={CX}
            y={CY}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="var(--color-text-disabled)"
            fontFamily='"JetBrains Mono", monospace'
            fontWeight={500}
            fontSize="24"
          >
            0
          </text>
        </svg>
      </div>
    );
  }

  // Build arc data
  const gapFraction = GAP_PX / CIRCUMFERENCE;
  let offsetAngle = 0; // fraction of full circle
  type ArcData = {
    dashArray: string;
    dashOffset: number;
    color: string;
    slice: DonutSlice;
    index: number;
  };
  const arcs: ArcData[] = slices.map((slice, index) => {
    const fraction = slice.amount / total;
    // Subtract gap from both sides
    const arcFraction = Math.max(0, fraction - gapFraction);
    const dashLength = arcFraction * CIRCUMFERENCE;
    const dashGap = CIRCUMFERENCE - dashLength;

    // Offset: position at current angle, then half-gap forward
    const strokeDashOffset = -(offsetAngle * CIRCUMFERENCE) + (gapFraction / 2) * CIRCUMFERENCE;

    offsetAngle += fraction;

    return {
      dashArray: `${dashLength} ${dashGap}`,
      dashOffset: strokeDashOffset,
      color: slice.color,
      slice,
      index,
    };
  });

  return (
    <div
      style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-4) 0' }}
    >
      <svg
        viewBox="0 0 200 200"
        width="200"
        height="200"
        onClick={handleChartClick}
        style={{ cursor: 'pointer', display: 'block', overflow: 'visible' }}
        aria-label="Category spending chart — tap to toggle expense/income"
        role="img"
      >
        <g transform={`rotate(-90 ${CX} ${CY})`}>
          {arcs.map((arc) => {
            const isActive = activeIndex === arc.index;
            const isInactive = activeIndex !== null && !isActive;
            const delay = arc.index * 40;

            return (
              <circle
                key={arc.slice.id}
                cx={CX}
                cy={CY}
                r={R}
                fill="none"
                stroke={arc.color}
                strokeWidth={STROKE_WIDTH}
                strokeDasharray={animated ? arc.dashArray : `0 ${CIRCUMFERENCE}`}
                strokeDashoffset={arc.dashOffset}
                strokeLinecap="butt"
                style={{
                  opacity: isInactive ? 0.35 : 1,
                  filter: isActive
                    ? `brightness(1.3) drop-shadow(0 0 6px ${arc.color})`
                    : 'none',
                  transition: animated
                    ? `stroke-dasharray 400ms ${delay}ms ease-out, opacity 200ms ease-out, filter 200ms ease-out`
                    : 'opacity 200ms ease-out, filter 200ms ease-out',
                  cursor: 'pointer',
                }}
                onClick={(e) => handleSliceClick(e, arc.index)}
              />
            );
          })}
        </g>

        {/* Center text: primary (active type) on top, secondary below */}
        {(() => {
          const isExpense = categoriesViewType === 'EXPENSE';
          const primaryAmount = isExpense ? totalExpense : totalIncome;
          const secondaryAmount = isExpense ? totalIncome : totalExpense;
          const primaryColor = isExpense ? 'var(--color-expense)' : 'var(--color-income)';
          const secondaryColor = isExpense ? 'var(--color-income)' : 'var(--color-expense)';
          const primaryPrefix = isExpense ? '-' : '+';
          const secondaryPrefix = isExpense ? '+' : '-';
          const primaryStr = `${primaryPrefix}${formatAmount(primaryAmount)}`;
          const secondaryStr = `${secondaryPrefix}${formatAmount(secondaryAmount)}`;
          const primaryFontSize = dynamicFontSize(primaryStr, 24, 14);
          const secondaryFontSize = dynamicFontSize(secondaryStr, 14, 10);
          const lineHeightRatio = 1.2;
          const primaryLineHeight = primaryFontSize * lineHeightRatio;
          const secondaryLineHeight = secondaryFontSize * lineHeightRatio;
          const gap = 4;
          const primaryY = CY - gap / 2 - primaryLineHeight / 2;
          const secondaryY = CY + gap / 2 + secondaryLineHeight / 2;
          return (
            <>
              <text
                x={CX}
                y={primaryY}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={primaryColor}
                fontFamily='"JetBrains Mono", monospace'
                fontWeight={600}
                fontSize={primaryFontSize}
              >
                {primaryStr}
              </text>
              <text
                x={CX}
                y={secondaryY}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={secondaryColor}
                fontFamily='"JetBrains Mono", monospace'
                fontWeight={400}
                fontSize={secondaryFontSize}
                opacity={0.6}
              >
                {secondaryStr}
              </text>
            </>
          );
        })()}
      </svg>
    </div>
  );
}
