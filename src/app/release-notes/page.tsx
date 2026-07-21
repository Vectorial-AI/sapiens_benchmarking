import type { Metadata } from "next";
import { IBM_Plex_Mono } from "next/font/google";
import { ReleaseNotesView } from "./release-notes-view";

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Release Notes — Vectorial AI · SAPIENS",
  description:
    "Product updates from the Vectorial AI team across the SAPIENS behavior model, simulation suite, and data sources.",
};

export default function ReleaseNotesPage() {
  return (
    <div className={ibmPlexMono.variable}>
      <ReleaseNotesView />
    </div>
  );
}
