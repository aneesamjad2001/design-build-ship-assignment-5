import type { Metadata } from "next";
import { SystemView } from "@/components/SystemView";

export const metadata: Metadata = { title: "Under the hood" };

export default function SystemPage() {
  return <SystemView />;
}
