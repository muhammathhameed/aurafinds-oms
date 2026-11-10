import type { ReactNode } from "react";

export const metadata = { title: "AuraFinds Operations", robots: { index: false, follow: false } };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f6f7f9", color: "#111" }}>
        {children}
      </body>
    </html>
  );
}
