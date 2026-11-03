import { Show } from "@clerk/nextjs";
import Link from "next/link";
import { TripBoard } from "@/components/TripBoard";
import { VerdictBadge } from "@/components/VerdictBadge";

function Landing() {
  return (
    <div className="space-y-6 py-4">
      <h1 className="text-3xl font-bold leading-tight tracking-tight">
        A bike at the start, a dock at the end?
      </h1>
      <p className="text-lg text-muted">
        Follow the Divvy trips you actually make. Dockcheck shows, live, whether there&rsquo;s a bike
        where you start and a free dock where you&rsquo;re going, with backups nearby when there isn&rsquo;t.
      </p>

      <figure className="rounded-2xl border border-line bg-surface p-4">
        <figcaption className="mb-2 text-sm font-medium text-muted">Example</figcaption>
        <p className="font-semibold">Home → the Reg</p>
        <VerdictBadge tone="go" word="Go" />
        <p className="mt-1 text-muted">6 bikes at the start, 9 docks at the end</p>
      </figure>

      <div className="flex flex-col gap-3">
        <Link
          href="/sign-in"
          className="rounded-xl bg-accent px-4 py-3 text-center text-lg font-semibold text-accent-text"
        >
          Sign in
        </Link>
        <Link href="/sign-up" className="rounded-xl border border-line px-4 py-3 text-center text-lg font-semibold">
          Create an account
        </Link>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <>
      <Show when="signed-out">
        <Landing />
      </Show>
      <Show when="signed-in">
        <TripBoard />
      </Show>
    </>
  );
}
