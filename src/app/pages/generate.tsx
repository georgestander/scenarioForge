import type { RequestInfo } from "rwsdk/worker";
import type { AppContext } from "@/worker";
import { redirect } from "@/app/shared/api";
import {
  getProjectByIdForOwner,
  getSourceManifestById,
  getLatestSourceManifestForProject,
  listScenarioPacksForProject,
} from "@/services/store";
import { GenerateClient } from "./GenerateClient";

type AppRequestInfo = RequestInfo<{ projectId: string }, AppContext>;

export const GeneratePage = ({ ctx, params }: AppRequestInfo) => {
  const principal = ctx?.auth?.principal ?? null;

  if (!principal) {
    return redirect("/");
  }

  const projectId = params?.projectId ?? "";
  const project = getProjectByIdForOwner(projectId, principal.id);

  if (!project) {
    return redirect("/dashboard");
  }

  const manifest =
    (project.activeManifestId
      ? getSourceManifestById(principal.id, project.activeManifestId)
      : null) ?? getLatestSourceManifestForProject(principal.id, projectId);
  if (!manifest) {
    return redirect(`/projects/${projectId}/sources`);
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

  return (
    <GenerateClient
      projectId={projectId}
      project={project}
      initialManifest={manifest}
      initialPacks={packs}
    />
  );
};
