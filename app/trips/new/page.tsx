import type { Metadata } from "next";
import { TripForm } from "@/components/TripForm";

export const metadata: Metadata = { title: "Add a trip" };

export default function NewTripPage() {
  return (
    <div className="space-y-5 py-2">
      <h1 className="text-2xl font-bold tracking-tight">Add a trip</h1>
      <TripForm />
    </div>
  );
}
