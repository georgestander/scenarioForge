import type { RequestInfo } from "rwsdk/worker";
import type { AppContext } from "@/worker";
import { redirect } from "@/app/shared/api";
import { listProjectsForOwner } from "@/services/store";
import { DashboardClient } from "./DashboardClient";

type AppRequestInfo = RequestInfo<any, AppContext>;

export const DashboardPage = ({ ctx }: AppRequestInfo) => {
  const principal = ctx?.auth?.principal ?? null;

  if (!principal) {
    return redirect("/");
  }

  const projects = listProjectsForOwner(principal.id);

  return <DashboardClient initialProjects={projects} />;
};
