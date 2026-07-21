import { Outlet, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import BottomNav from "./BottomNav";
import TopBar from "./TopBar";
import ContentColumn from "./ContentColumn";
import type { TabName } from "../../types";

function getActiveTab(pathname: string): TabName {
  if (pathname.startsWith("/accounts")) return "accounts";
  if (pathname.startsWith("/categories")) return "categories";
  if (pathname.startsWith("/transactions")) return "transactions";
  if (pathname.startsWith("/budget")) return "budget";
  if (pathname.startsWith("/overview")) return "overview";
  return "accounts";
}

export default function TabLayout() {
  const { t } = useTranslation();
  const location = useLocation();
  const activeTab = getActiveTab(location.pathname);
  const title = t(`nav.${activeTab}`);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
        background: "var(--color-bg)",
      }}
    >
      <TopBar title={title} />
      <ContentColumn>
        <Outlet />
      </ContentColumn>
      <BottomNav />
    </div>
  );
}
