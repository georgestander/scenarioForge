import type { RequestInfo } from "rwsdk/worker";
import type { AppContext } from "@/worker";
import {
  getProjectByIdForOwner,
  listScenarioPacksForProject,
} from "@/services/store";
import { ReviewClient } from "./ReviewClient";

type AppRequestInfo = RequestInfo<{ projectId: string }, AppContext>;

export const ReviewPage = ({ ctx, params }: AppRequestInfo) => {
  const principal = ctx?.auth?.principal ?? null;

  if (!principal) {
    return Response.redirect("/") as unknown as React.JSX.Element;
  }

  const projectId = params?.projectId ?? "";
  const project = getProjectByIdForOwner(projectId, principal.id);

  if (!project) {
    return Response.redirect("/dashboard") as unknown as React.JSX.Element;
  }

  const packs = listScenarioPacksForProject(principal.id, projectId);
  if (packs.length === 0) {
    return Response.redirect(`/projects/${projectId}/generate`) as unknown as React.JSX.Element;
  }

  return (
    <ReviewClient
      projectId={projectId}
      project={project}
      initialPacks={packs}
    />
  );
};
