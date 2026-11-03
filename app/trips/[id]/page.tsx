import type { Metadata } from "next";
import { TripForm } from "@/components/TripForm";

export const metadata: Metadata = { title: "Edit trip" };

export default async function EditTripPage({ params }: PageProps<"/trips/[id]">) {
  const { id } = await params;
  return (
    <div className="space-y-5 py-2">
      <h1 className="text-2xl font-bold tracking-tight">Edit trip</h1>
      <TripForm tripId={id} />
    </div>
  );
}
