import { redirect } from "next/navigation";

// Library was renamed to Ideas.
export default function LibraryRedirect() {
  redirect("/ideas");
}
