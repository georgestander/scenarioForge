import type { RequestInfo } from "rwsdk/worker";
import type { AppContext } from "@/worker";
import { redirect } from "@/app/shared/api";
import {
  getProjectByIdForOwner,
  listScenarioPacksForProject,
} from "@/services/store";
import { ReviewClient } from "./ReviewClient";

type AppRequestInfo = RequestInfo<{ projectId: string }, AppContext>;

export const ReviewPage = ({ ctx, params }: AppRequestInfo) => {
  const principal = ctx?.auth?.principal ?? null;

  if (!principal) {
    return redirect("/");
  }

  const projectId = params?.projectId ?? "";
  const project = getProjectByIdForOwner(projectId, principal.id);

  if (!project) {
    return redirect("/dashboard");
  }

  const latestPacks = listScenarioPacksForProject(principal.id, projectId);
  const packs =
    project.activeScenarioPackId
      ? (() => {
          const activePack = latestPacks.find((pack) => pack.id === project.activeScenarioPackId);
          if (!activePack) {
            return latestPacks;
          }
          return [activePack, ...latestPacks.filter((pack) => pack.id !== activePack.id)];
        })()
      : latestPacks;
  if (packs.length === 0) {
    return redirect(`/projects/${projectId}/generate`);
  }

  return (
    <ReviewClient
      projectId={projectId}
      project={project}
      initialPacks={packs}
    />
  );
};
