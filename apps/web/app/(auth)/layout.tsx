import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";

// Split screen: the form on the left at a comfortable reading width, the rink
// motif on the right. The motif is the blueprint grid at true 10ft scale rather
// than a stock illustration — it is the same surface the product draws on.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-[calc(100vh-4rem)] lg:grid-cols-2">
      <div className="flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-[26rem]">
          <Link href="/" className="inline-block">
            <Wordmark />
          </Link>
          {children}
        </div>
      </div>

      <aside
        aria-hidden
        className="relative hidden border-l-2 border-l-ice-blue bg-sunken lg:block"
      >
        <div className="blueprint absolute inset-0" />
        <div className="absolute inset-0 flex items-center justify-center p-16">
          <figure className="max-w-[30rem]">
            <blockquote className="font-display text-[clamp(1.5rem,2.4vw,2.1rem)] font-bold uppercase leading-[1.05] tracking-[-0.015em] text-balance text-ink">
              You get the sheet for fifty minutes. Spend them coaching, not
              drawing on a whiteboard.
            </blockquote>
          </figure>
        </div>
      </aside>
    </div>
  );
}
