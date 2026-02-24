import type { RequestInfo } from "rwsdk/worker";
import type { AppContext } from "@/worker";
import { listProjectsForOwner } from "@/services/store";
import { DashboardClient } from "./DashboardClient";

type AppRequestInfo = RequestInfo<any, AppContext>;

export const DashboardPage = ({ ctx }: AppRequestInfo) => {
  const principal = ctx?.auth?.principal ?? null;

  if (!principal) {
    return Response.redirect("/") as unknown as React.JSX.Element;
  }

  const projects = listProjectsForOwner(principal.id);

  return <DashboardClient initialProjects={projects} />;
};
