import { useState } from "react";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { ChevronRight } from "lucide-react";
import { getLocalDateString, parsePeriodFilter, getPeriodLabel } from "../../utils/date-utils";
import PeriodFilterComponent from "../shared/PeriodFilter";
import { useSettingsStore } from "../../stores/settings-store";
import { exportService } from "../../services/export.service";
import { useToast } from "../shared/Toast";
import BottomSheet from "../layout/BottomSheet";
import type { PeriodFilter } from "../../types";

export function ExportSettings() {
  const { t } = useTranslation();
  const { show } = useToast();
  const mainCurrency = useSettingsStore((s) => s.mainCurrency);
  const today = getLocalDateString();

  const [period, setPeriod] = useState<PeriodFilter>({
    type: "month",
    startDate: today,
    endDate: today,
  });
  const [isExporting, setIsExporting] = useState(false);
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  const periodLabel = getPeriodLabel(period);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const { start, end } = parsePeriodFilter(period);
      const startDate = format(start, "yyyy-MM-dd");
      const endDate = format(end, "yyyy-MM-dd");
      await exportService.exportTransactions(startDate, endDate, mainCurrency);
      show(t("settings.export.complete"), "success");
      setIsSheetOpen(false);
    } catch {
      show(t("settings.export.error"), "error");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsSheetOpen(true)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          minHeight: "52px",
          width: "100%",
          padding: "0 var(--space-4)",
          background: "none",
          border: "none",
          borderBottom: "1px solid var(--color-border)",
          cursor: "pointer",
          color: "var(--color-text)",
          fontSize: "var(--text-body)",
          fontFamily: '"DM Sans", sans-serif',
        }}
      >
        <span style={{ fontWeight: 500 }}>{t("settings.export.label")}</span>
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
            color: "var(--color-text-secondary)",
          }}
        >
          <span style={{ fontSize: "var(--text-body)", fontFamily: '"DM Sans", sans-serif' }}>
            {periodLabel}
          </span>
          <ChevronRight size={16} strokeWidth={2} />
        </span>
      </button>

      <BottomSheet
        isOpen={isSheetOpen}
        onClose={() => {
          if (!isExporting) {
            setIsSheetOpen(false);
          } else {
            show(t("settings.export.inProgress"), "info");
          }
        }}
        title={t("settings.export.sheetTitle")}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-4)",
            padding: "var(--space-4)",
          }}
        >
          <PeriodFilterComponent value={period} onChange={setPeriod} />
          <button
            type="button"
            onClick={handleExport}
            disabled={isExporting}
            style={{
              minHeight: "44px",
              width: "100%",
              background: "var(--color-primary)",
              color: "var(--color-bg)",
              border: "none",
              borderRadius: "var(--radius-btn)",
              fontFamily: '"DM Sans", sans-serif',
              fontWeight: 500,
              fontSize: "var(--text-body)",
              cursor: isExporting ? "not-allowed" : "pointer",
              opacity: isExporting ? 0.6 : 1,
            }}
          >
            {isExporting ? t("settings.export.exporting") : t("settings.export.cta")}
          </button>
        </div>
      </BottomSheet>
    </>
  );
}
