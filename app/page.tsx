import { redirect } from "next/navigation";

export default function Home() {
  redirect("/dashboard"); // middleware decide entre /dashboard e /login
}
