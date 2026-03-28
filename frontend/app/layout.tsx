import type { Metadata, Viewport } from "next"
import { Inter, Geist_Mono } from "next/font/google"
import { Toaster } from "@/components/ui/toaster"
import { SocketProvider } from "@/context/SocketContext"
import "./globals.css"

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
})

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
})

export const metadata: Metadata = {
  title: "Drone Damage Mapper",
  description: "Real-time drone-based damage mapping and priority response system for first responders."
}

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  width: "device-width",
  initialScale: 1,
  userScalable: false,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} ${geistMono.variable} font-sans antialiased bg-background text-foreground`}>
        <SocketProvider>
          {children}
          <Toaster />
        </SocketProvider>
      </body>
    </html>
  )
}
