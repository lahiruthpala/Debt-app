import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Debt Servitude Agreement | Madam Vidumini',
  description: 'Fantasy Financial Debt & Servitude Tracker',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
