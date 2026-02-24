import type { RequestInfo } from "rwsdk/worker";
import type { AppContext } from "@/worker";
import { redirect } from "@/app/shared/api";
import {
  getProjectByIdForOwner,
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

  const manifest = getLatestSourceManifestForProject(principal.id, projectId);
  if (!manifest) {
    return redirect(`/projects/${projectId}/sources`);
  }

  const packs = listScenarioPacksForProject(principal.id, projectId);

  return (
    <GenerateClient
      projectId={projectId}
      project={project}
      initialManifest={manifest}
      initialPacks={packs}
    />
  );
};
