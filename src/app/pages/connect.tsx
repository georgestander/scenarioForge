import type { RequestInfo } from "rwsdk/worker";
import type { AppContext } from "@/worker";
import {
  getProjectByIdForOwner,
  getGitHubConnectionForPrincipal,
} from "@/services/store";
import { ConnectClient } from "./ConnectClient";

type AppRequestInfo = RequestInfo<{ projectId: string }, AppContext>;

export const ConnectPage = ({ ctx, params }: AppRequestInfo) => {
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
  const connectionView = connection
    ? {
        id: connection.id,
        principalId: connection.principalId,
        provider: connection.provider,
        status: connection.status,
        accountLogin: connection.accountLogin,
        installationId: connection.installationId,
        accessTokenExpiresAt: connection.accessTokenExpiresAt,
        repositories: connection.repositories,
        createdAt: connection.createdAt,
        updatedAt: connection.updatedAt,
      }
    : null;

  return (
    <ConnectClient
      projectId={projectId}
      project={project}
      initialConnection={connectionView}
      initialRepos={connection?.repositories ?? []}
    />
  );
};
