import type { Metadata } from "next";
import WalletContextProvider from "@/components/WalletContextProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Abyss Bridge — Entertainment Finance on MagicBlock ER",
  description:
    "A real-time glass-bridge game on Solana: encrypted layouts (PER), VRF shuffles, native session keys, and the Resurrection Rush.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <WalletContextProvider>{children}</WalletContextProvider>
      </body>
    </html>
  );
}
