import { Logo } from "@/components/marketing/Logo";
import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-ink-50 flex flex-col">
      <header className="py-6">
        <div className="max-w-md mx-auto px-6">
          <Logo />
        </div>
      </header>
      <main className="flex-1 flex items-center justify-center px-6 py-8">
        <div className="w-full max-w-md">{children}</div>
      </main>
      <footer className="py-6 text-center text-sm text-ink-500">
        <Link href="/" className="hover:text-ink-700">← Zpět na hlavní stránku</Link>
      </footer>
    </div>
  );
}
