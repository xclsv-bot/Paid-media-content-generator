import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export default async function Home() {
  const user = await getCurrentUser();
  if (user?.role === "creator") redirect("/queue");
  if (user?.role === "client_viewer") redirect("/client");
  redirect("/ideas");
}
