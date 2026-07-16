import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { APP_TITLE } from "@/lib/public-config";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: APP_TITLE,
    template: `%s · ${APP_TITLE}`,
  },
  description: "미뤄둔 결정을 작고 명확하게 끝내는 의사결정 인박스",
  applicationName: APP_TITLE,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b0d10",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ko">
      <body>
        <div className="site-shell">{children}</div>
      </body>
    </html>
  );
}
