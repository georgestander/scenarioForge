import type { RequestInfo } from "rwsdk/worker";
import type { AppContext } from "@/worker";
import { redirect } from "@/app/shared/api";
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
    return redirect("/");
  }

  const projectId = params?.projectId ?? "";
  const project = getProjectByIdForOwner(projectId, principal.id);

  if (!project) {
    return redirect("/dashboard");
  }

  const connection = getGitHubConnectionForPrincipal(principal.id);
  if (!connection) {
    return redirect(`/projects/${projectId}/connect`);
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
