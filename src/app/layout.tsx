import "~/styles/globals.css";

import { GeistSans } from "geist/font/sans";
import { type Metadata } from "next";
import { Header } from "~/components/header";
import { Footer } from "~/components/footer";
import { LivePresence } from "~/components/live-presence";
import { CSPostHogProvider } from "./providers";
import { SITE_URL } from "~/lib/site";

export const metadata: Metadata = {
  title: "GitUML",
  description:
    "Turn any GitHub repository into an evidence-based UML or architecture diagram in seconds.",
  metadataBase: new URL(SITE_URL),
  keywords: [
    "github",
    "git diagram",
    "git diagram generator",
    "git diagram tool",
    "git diagram maker",
    "git diagram creator",
    "diagram",
    "repository",
    "visualization",
    "code structure",
    "system design",
    "software architecture",
    "software design",
    "software engineering",
    "software development",
    "open source",
    "open source software",
    "xoity",
    "mohammad abu-khader",
    "gituml",
    "uml diagram generator",
    "class diagram",
    "sequence diagram",
  ],
  authors: [{ name: "Mohammad Abu-Khader", url: "https://github.com/xoity" }],
  creator: "Mohammad Abu-Khader",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    title: "GitUML - Repository to UML",
    description:
      "Turn any GitHub repository into an interactive diagram for visualization.",
    siteName: "GitUML",
  },
  twitter: {
    card: "summary_large_image",
    title: "GitUML - Repository to UML",
    description:
      "Turn any GitHub repository into an interactive diagram for visualization.",
    creator: "@xoity",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-video-preview": -1,
      "max-snippet": -1,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${GeistSans.variable}`}
    >
      <body className="flex min-h-screen flex-col">
        <CSPostHogProvider>
          <Header />
          <div className="flex-grow">{children}</div>
          <Footer />
          <LivePresence />
        </CSPostHogProvider>
      </body>
    </html>
  );
}
