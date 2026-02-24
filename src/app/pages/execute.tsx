import type { RequestInfo } from "rwsdk/worker";
import type { AppContext } from "@/worker";
import { redirect } from "@/app/shared/api";
import {
  getProjectByIdForOwner,
  listScenarioPacksForProject,
} from "@/services/store";
import { ExecuteClient } from "./ExecuteClient";

type AppRequestInfo = RequestInfo<{ projectId: string }, AppContext>;

export const ExecutePage = ({ ctx, params }: AppRequestInfo) => {
  const principal = ctx?.auth?.principal ?? null;

  if (!principal) {
    return redirect("/");
  }

  const projectId = params?.projectId ?? "";
  const project = getProjectByIdForOwner(projectId, principal.id);

  if (!project) {
    return redirect("/dashboard");
  }

  const packs = listScenarioPacksForProject(principal.id, projectId);
  if (packs.length === 0) {
    return redirect(`/projects/${projectId}/generate`);
  }

  return (
    <ExecuteClient
      projectId={projectId}
      project={project}
      initialPack={packs[0]}
    />
  );
};
