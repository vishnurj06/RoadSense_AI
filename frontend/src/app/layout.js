import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

/**
 * Inter for the interface, JetBrains Mono for data.
 *
 * The old UI ran everything through one sans at 9–11px uppercase bold, so
 * labels and values were typographically indistinguishable — the whole panel
 * read as texture. Splitting the two roles is what makes the numbers legible:
 * anything the machine measured (IDs, coordinates, versions, latencies,
 * thresholds) wears the mono; everything a human wrote wears Inter.
 */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

export const metadata = {
  title: "RoadSense AI — Live Road Condition Monitoring Platform",
  description:
    "AI-powered real-time detection, tagging, and monitoring of potholes, road cracks, and other road damages.",
};

export const viewport = {
  themeColor: "#06080B",
  colorScheme: "dark",
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="bg-canvas text-ink min-h-full font-sans">{children}</body>
    </html>
  );
}
