import type { RequestInfo } from "rwsdk/worker";
import type { AppContext } from "@/worker";
import {
  getProjectByIdForOwner,
  getGitHubConnectionForPrincipal,
  listSourcesForProject,
  listSourceManifestsForProject,
} from "@/services/store";
import { SourcesClient } from "./SourcesClient";

type AppRequestInfo = RequestInfo<{ projectId: string }, AppContext>;

export const SourcesPage = ({ ctx, params }: AppRequestInfo) => {
  const principal = ctx?.auth?.principal ?? null;

  if (!principal) {
    return Response.redirect("/") as unknown as React.JSX.Element;
  }

  const projectId = params?.projectId ?? "";
  const project = getProjectByIdForOwner(projectId, principal.id);

  if (!project) {
    return Response.redirect("/dashboard") as unknown as React.JSX.Element;
  }

  const connection = getGitHubConnectionForPrincipal(principal.id);
  if (!connection) {
    return Response.redirect(`/projects/${projectId}/connect`) as unknown as React.JSX.Element;
  }

  const sources = listSourcesForProject(principal.id, projectId);
  const manifests = listSourceManifestsForProject(principal.id, projectId);

  return (
    <SourcesClient
      projectId={projectId}
      project={project}
      initialSources={sources}
      initialManifests={manifests}
    />
  );
};
