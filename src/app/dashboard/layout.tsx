import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard | AI Trading Agent",
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="flex min-h-full flex-col">{children}</div>;
}
