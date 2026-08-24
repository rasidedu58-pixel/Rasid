"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoadingRegion } from "@academic-precision/ui";
import { useSession } from "../lib/session-provider";

/** Root route is a pure redirect — never a product screen. */
export default function HomePage() {
  const router = useRouter();
  const { status } = useSession();

  useEffect(() => {
    if (status === "authenticated") router.replace("/dashboard");
    else if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  return <LoadingRegion className="min-h-screen" />;
}
