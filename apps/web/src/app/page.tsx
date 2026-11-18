"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Spinner } from "@/components/ui";
import { useSession } from "@/lib/session";

export default function Home() {
  const { me, loading } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(me ? "/dashboard" : "/login");
  }, [me, loading, router]);

  return (
    <div className="flex min-h-dvh items-center justify-center">
      <Spinner />
    </div>
  );
}
