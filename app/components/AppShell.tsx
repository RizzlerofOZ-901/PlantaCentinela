"use client";

import { usePathname } from "next/navigation";
import Sidebar from "@/app/components/Sidebar";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLoginPage = pathname === "/";

  if (isLoginPage) {
    return <>{children}</>;
  }

  return (
    <div className="shell">
      <Sidebar />
      <main>{children}</main>
    </div>
  );
}
