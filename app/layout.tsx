import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://rag-demo.phaiworks.com"),
  title: "Clinical Knowledge Base — RAG Retrieval Demo",
  description:
    "A live demo of a strict-schema RAG retrieval pipeline: clinically-structured biomarker briefs embedded with OpenAI and retrieved from Pinecone with hard metadata filtering.",
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    url: "https://rag-demo.phaiworks.com/",
    siteName: "PH AI Works — RAG Demo",
    title: "Clinical Knowledge Base — RAG Retrieval Demo",
    description:
      "Strict-schema RAG retrieval over biomarker briefs. Pinecone + OpenAI embeddings, with hard metadata filtering and anti-hallucination thresholds.",
  },
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        className={
          geistSans.variable +
          " " +
          geistMono.variable +
          " antialiased min-h-screen flex flex-col"
        }
      >
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
