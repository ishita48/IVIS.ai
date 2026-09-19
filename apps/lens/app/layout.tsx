import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { ThemeProvider } from "@/components/product/ThemeProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "LENS — The tutor that never gives you the answer",
  description:
    "LENS watches how you actually work — on your screen and in your physical workspace — and intervenes with the smallest possible nudge instead of the answer.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-ink-950 text-ink-100 antialiased">
        <ClerkProvider
          appearance={{
            variables: {
              colorPrimary: "#00C2A8",
              colorBackground: "#ffffff",
              colorInput: "#ffffff",
              colorInputForeground: "#0B1220",
              colorForeground: "#0B1220",
              colorMutedForeground: "#5A6577",
              colorDanger: "#E11D48",
              colorSuccess: "#059669",
              borderRadius: "12px",
              fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
              fontSize: "14px",
            },
          }}
        >
          <ThemeProvider>{children}</ThemeProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
