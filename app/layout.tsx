import type { Metadata } from "next"
import "./globals.css"
import PwaRegistrar from "./pwa-registrar"

export const metadata: Metadata = {
  title: "Velvet Ledger · Consensual fantasy play",
  description: "Private 18+ fictional debt ledger and consent-first partner play.",
  manifest: "/manifest.webmanifest",
  themeColor: "#221421",
  appleWebApp: {capable:true,statusBarStyle:"default",title:"Velvet Ledger"},
  icons: {icon:"/icons/icon.svg",apple:"/icons/icon.svg"},
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><PwaRegistrar/>{children}</body></html>
}
