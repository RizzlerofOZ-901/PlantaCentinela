"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Sidebar from "@/app/components/Sidebar";
import { getAllowedRoutes, getSessionUser } from "@/app/lib/session";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLoginPage = pathname === "/";
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    if (isLoginPage) {
      setAuthorized(true);
      return;
    }

    const user = getSessionUser();
    if (!user) {
      router.replace("/");
      return;
    }

    const allowed = getAllowedRoutes(user);
    const hasAccess = allowed.some((route) => pathname.startsWith(route));
    if (!hasAccess) {
      router.replace("/inicio");
      return;
    }

    setAuthorized(true);
  }, [isLoginPage, pathname, router]);

  if (isLoginPage) {
    return <>{children}</>;
  }

  if (!authorized) {
    return null;
  }

  return (
    <div className="shell">
      <Sidebar />
      <main>{children}</main>
    </div>
  );
}

