import type { RequestInfo } from "rwsdk/worker";
import type { AppContext } from "@/worker";
import { redirect } from "@/app/shared/api";
import {
  getLatestProjectPrReadinessForProject,
  getProjectByIdForOwner,
  listExecutionJobsForProject,
  listScenarioPacksForProject,
} from "@/services/store";
import { ExecuteClient } from "./ExecuteClient";

type AppRequestInfo = RequestInfo<{ projectId: string }, AppContext>;

export const ExecutePage = ({ ctx, params, request }: AppRequestInfo) => {
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

  const requestedPackId = String(new URL(request.url).searchParams.get("packId") ?? "").trim();
  const requestedJobId = String(new URL(request.url).searchParams.get("jobId") ?? "").trim();
  if (requestedPackId && !packs.some((pack) => pack.id === requestedPackId)) {
    return redirect(`/projects/${projectId}/review`);
  }

  const jobs = listExecutionJobsForProject(principal.id, projectId);
  if (requestedJobId && !jobs.some((job) => job.id === requestedJobId)) {
    return redirect(`/projects/${projectId}/execute`);
  }

  const activePack = project.activeScenarioPackId
    ? packs.find((pack) => pack.id === project.activeScenarioPackId) ?? null
    : null;
  const initialPack = requestedPackId
    ? packs.find((pack) => pack.id === requestedPackId) ?? packs[0]
    : activePack ?? packs[0];
  const initialJob = requestedJobId
    ? jobs.find((job) => job.id === requestedJobId) ?? null
    : jobs.find((job) => job.status === "queued" || job.status === "running") ?? null;
  const initialReadiness = getLatestProjectPrReadinessForProject(principal.id, projectId);

  return (
    <ExecuteClient
      projectId={projectId}
      project={project}
      initialPack={initialPack}
      initialJob={initialJob}
      initialReadiness={initialReadiness}
    />
  );
};
