import type { RequestInfo } from "rwsdk/worker";
import type { AppContext } from "@/worker";
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
    return Response.redirect("/") as unknown as React.JSX.Element;
  }

  const projectId = params?.projectId ?? "";
  const project = getProjectByIdForOwner(projectId, principal.id);

  if (!project) {
    return Response.redirect("/dashboard") as unknown as React.JSX.Element;
  }

  const manifest = getLatestSourceManifestForProject(principal.id, projectId);
  if (!manifest) {
    return Response.redirect(`/projects/${projectId}/sources`) as unknown as React.JSX.Element;
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
