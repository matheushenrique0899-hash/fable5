import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/sidebar";
import { PendingApproval } from "@/components/pending-approval";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Verifica se a conta foi aprovada pelo admin
  const { data: profile } = await supabase
    .from("profiles")
    .select("approved")
    .eq("id", user.id)
    .maybeSingle();

  const approved = profile?.approved ?? false;

  if (!approved) {
    return <PendingApproval email={user.email ?? ""} />;
  }

  return (
    <div className="min-h-screen">
      <Sidebar email={user.email ?? ""} />
      <main className="px-4 py-6 md:ml-60 md:px-8 md:py-8">
        <div className="mx-auto max-w-6xl animate-fade-up">{children}</div>
      </main>
    </div>
  );
}
