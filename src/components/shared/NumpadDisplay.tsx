import { useLayoutEffect, useRef, useState, useCallback } from "react";
import { formatNumpadDisplay } from "@/utils/numpad-utils";

export interface NumpadDisplayProps {
  value: string;
  isActive: boolean;
  suffix?: string;
  evaluatedDisplay?: string;
  minFontSize?: number;
  maxFontSize?: number;
  color?: string;
  textShadow?: string;
  align?: "left" | "center" | "right";
  style?: React.CSSProperties;
}

export function NumpadDisplay({
  value,
  isActive,
  suffix,
  evaluatedDisplay,
  minFontSize = 16,
  maxFontSize = 40,
  color = "var(--color-text)",
  textShadow,
  align = "center",
  style,
}: NumpadDisplayProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [fontSize, setFontSize] = useState(maxFontSize);

  const fit = useCallback(() => {
    const wrapper = wrapperRef.current;
    const text = textRef.current;
    if (!wrapper || !text) return;
    let size = maxFontSize;
    text.style.fontSize = `${size}px`;
    while (text.scrollWidth > wrapper.clientWidth && size > minFontSize) {
      size -= 1;
      text.style.fontSize = `${size}px`;
    }
    setFontSize(size);
  }, [maxFontSize, minFontSize]);

  useLayoutEffect(() => {
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(fit);
    if (wrapperRef.current) ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, [fit, value, suffix, evaluatedDisplay]);

  return (
    <div
      ref={wrapperRef}
      style={{
        width: "100%",
        textAlign: align,
        overflow: "hidden",
        ...style,
      }}
    >
      <span
        ref={textRef}
        style={{
          fontFamily: '"JetBrains Mono", monospace',
          fontWeight: 600,
          fontSize: `${fontSize}px`,
          color,
          textShadow,
          whiteSpace: "nowrap",
          display: "inline-block",
        }}
      >
        {formatNumpadDisplay(value)}
        {suffix}
        {isActive && (
          <span className="numpad-cursor" aria-hidden="true">
            |
          </span>
        )}
      </span>
      {evaluatedDisplay && (
        <div
          style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontWeight: 500,
            fontSize: "var(--text-caption)",
            color: "var(--color-text-secondary)",
            marginTop: "var(--space-1)",
          }}
        >
          {evaluatedDisplay}
        </div>
      )}
    </div>
  );
}
