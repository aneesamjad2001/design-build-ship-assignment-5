"use client";

import { Show, UserButton } from "@clerk/nextjs";
import Link from "next/link";

function Mark() {
  // A dock: a bike wheel resting in a slot.
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden>
      <circle cx="12" cy="10" r="6" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <path d="M4 20h16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M12 16v4" stroke="currentColor" strokeWidth="2.5" />
    </svg>
  );
}

export function SiteHeader() {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex h-14 max-w-md items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <Mark />
          Dockcheck
        </Link>
        <Show when="signed-in">
          <UserButton />
        </Show>
      </div>
    </header>
  );
}
