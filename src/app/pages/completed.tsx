import type { RequestInfo } from "rwsdk/worker";
import type { AppContext } from "@/worker";
import { redirect } from "@/app/shared/api";
import {
  getProjectByIdForOwner,
  listScenarioRunsForProject,
  listFixAttemptsForProject,
  listPullRequestsForProject,
} from "@/services/store";
import { buildReviewBoard } from "@/services/reviewBoard";
import {
  listScenarioPacksForProject,
} from "@/services/store";
import { CompletedClient } from "./CompletedClient";

type AppRequestInfo = RequestInfo<{ projectId: string }, AppContext>;

export const CompletedPage = ({ ctx, params }: AppRequestInfo) => {
  const principal = ctx?.auth?.principal ?? null;

  if (!principal) {
    return redirect("/");
  }

  const projectId = params?.projectId ?? "";
  const project = getProjectByIdForOwner(projectId, principal.id);

  if (!project) {
    return redirect("/dashboard");
  }

  const runs = listScenarioRunsForProject(principal.id, projectId);
  if (runs.length === 0) {
    return redirect(`/projects/${projectId}/execute`);
  }

  const fixAttempts = listFixAttemptsForProject(principal.id, projectId);
  const pullRequests = listPullRequestsForProject(principal.id, projectId);
  const packs = listScenarioPacksForProject(principal.id, projectId);
  const reviewBoard = buildReviewBoard(project, packs, runs, pullRequests);

  return (
    <CompletedClient
      projectId={projectId}
      project={project}
      initialRuns={runs}
      initialFixAttempts={fixAttempts}
      initialPullRequests={pullRequests}
      initialReviewBoard={reviewBoard}
    />
  );
};
