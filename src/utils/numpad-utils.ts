function formatNumericSegment(seg: string): string {
  if (!seg) return seg;
  const dotIndex = seg.indexOf(".");
  const intPart = dotIndex === -1 ? seg : seg.slice(0, dotIndex);
  const decPart = dotIndex === -1 ? "" : seg.slice(dotIndex);
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, " ") + decPart;
}

export function formatNumpadDisplay(raw: string): string {
  if (!raw) return "0";
  const parts = raw.split(/([+\u2212\-×÷])/);
  return parts
    .map((part) => {
      if (/^[+\u2212\-×÷]$/.test(part)) return part;
      return formatNumericSegment(part);
    })
    .join("");
}
