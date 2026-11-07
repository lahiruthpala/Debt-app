import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "Velvet Ledger · Consensual fantasy play",
  description: "Private 18+ fictional debt ledger and consent-first partner play.",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>
}
