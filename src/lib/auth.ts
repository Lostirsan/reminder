import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import type { Organization } from "./types";

export const getSession = cache(async () => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
});

/** The signed-in user's company. Sends to /login or /onboarding when missing. */
export const requireOrg = cache(async () => {
  const { supabase, user } = await getSession();
  if (!user) redirect("/login");
  const { data: org } = await supabase.from("organizations").select("*").limit(1).maybeSingle<Organization>();
  if (!org) redirect("/onboarding");
  return { supabase, user, org };
});
