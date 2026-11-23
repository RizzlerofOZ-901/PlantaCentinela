import type { Metadata } from "next";
import "./globals.css";
import AppShell from "@/app/components/AppShell";

export const metadata: Metadata = {
  title: "Planta Centinela",
  description: "Control de embarques",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
