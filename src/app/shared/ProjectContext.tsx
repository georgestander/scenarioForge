"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type {
  FixAttempt,
  GitHubRepository,
  Project,
  PullRequestRecord,
  ReviewBoard,
  ScenarioPack,
  ScenarioRun,
  SourceManifest,
  SourceRecord,
} from "@/domain/models";
import type {
  CollectionPayload,
  GitHubConnectionView,
  ReviewBoardPayload,
} from "./types.js";

interface ProjectContextValue {
  projects: Project[];
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
  selectedProjectId: string;
  setSelectedProjectId: React.Dispatch<React.SetStateAction<string>>;
  githubConnection: GitHubConnectionView | null;
  setGithubConnection: React.Dispatch<React.SetStateAction<GitHubConnectionView | null>>;
  githubRepos: GitHubRepository[];
  setGithubRepos: React.Dispatch<React.SetStateAction<GitHubRepository[]>>;
  sources: SourceRecord[];
  setSources: React.Dispatch<React.SetStateAction<SourceRecord[]>>;
  selectedSourceIds: string[];
  setSelectedSourceIds: React.Dispatch<React.SetStateAction<string[]>>;
  manifests: SourceManifest[];
  setManifests: React.Dispatch<React.SetStateAction<SourceManifest[]>>;
  scenarioPacks: ScenarioPack[];
  setScenarioPacks: React.Dispatch<React.SetStateAction<ScenarioPack[]>>;
  selectedScenarioPackId: string;
  setSelectedScenarioPackId: React.Dispatch<React.SetStateAction<string>>;
  scenarioRuns: ScenarioRun[];
  setScenarioRuns: React.Dispatch<React.SetStateAction<ScenarioRun[]>>;
  fixAttempts: FixAttempt[];
  setFixAttempts: React.Dispatch<React.SetStateAction<FixAttempt[]>>;
  pullRequests: PullRequestRecord[];
  setPullRequests: React.Dispatch<React.SetStateAction<PullRequestRecord[]>>;
  reviewBoard: ReviewBoard | null;
  setReviewBoard: React.Dispatch<React.SetStateAction<ReviewBoard | null>>;
  loadProjectData: (projectId: string) => Promise<void>;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export const useProject = (): ProjectContextValue => {
  const ctx = useContext(ProjectContext);
  if (!ctx) {
    throw new Error("useProject must be used within a ProjectProvider");
  }
  return ctx;
};

export const ProjectProvider = ({
  children,
  initialProjects,
}: {
  children: React.ReactNode;
  initialProjects?: Project[];
}) => {
  const [projects, setProjects] = useState<Project[]>(initialProjects ?? []);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [githubConnection, setGithubConnection] = useState<GitHubConnectionView | null>(null);
  const [githubRepos, setGithubRepos] = useState<GitHubRepository[]>([]);
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [manifests, setManifests] = useState<SourceManifest[]>([]);
  const [scenarioPacks, setScenarioPacks] = useState<ScenarioPack[]>([]);
  const [selectedScenarioPackId, setSelectedScenarioPackId] = useState("");
  const [scenarioRuns, setScenarioRuns] = useState<ScenarioRun[]>([]);
  const [fixAttempts, setFixAttempts] = useState<FixAttempt[]>([]);
  const [pullRequests, setPullRequests] = useState<PullRequestRecord[]>([]);
  const [reviewBoard, setReviewBoard] = useState<ReviewBoard | null>(null);

  const lastProjectIdRef = useRef("");

  const resetProjectState = useCallback(() => {
    setSources([]);
    setSelectedSourceIds([]);
    setManifests([]);
    setScenarioPacks([]);
    setSelectedScenarioPackId("");
    setScenarioRuns([]);
    setFixAttempts([]);
    setPullRequests([]);
    setReviewBoard(null);
  }, []);

  const loadProjectData = useCallback(async (projectId: string) => {
    if (lastProjectIdRef.current !== projectId) {
      resetProjectState();
      lastProjectIdRef.current = projectId;
    }

    const [sourcesRes, manifestsRes, packsRes, runsRes, fixRes, prsRes, boardRes] =
      await Promise.all([
        fetch(`/api/projects/${projectId}/sources`),
        fetch(`/api/projects/${projectId}/source-manifests`),
        fetch(`/api/projects/${projectId}/scenario-packs`),
        fetch(`/api/projects/${projectId}/scenario-runs`),
        fetch(`/api/projects/${projectId}/fix-attempts`),
        fetch(`/api/projects/${projectId}/pull-requests`),
        fetch(`/api/projects/${projectId}/review-board`),
      ]);

    if (sourcesRes.ok) {
      const payload = (await sourcesRes.json()) as CollectionPayload<SourceRecord>;
      setSources(payload.data ?? []);
      setSelectedSourceIds(
        (payload.data ?? []).filter((item) => item.selected).map((item) => item.id),
      );
    } else {
      setSources([]);
      setSelectedSourceIds([]);
    }

    if (manifestsRes.ok) {
      const payload = (await manifestsRes.json()) as CollectionPayload<SourceManifest>;
      setManifests(payload.data ?? []);
    } else {
      setManifests([]);
    }

    if (packsRes.ok) {
      const payload = (await packsRes.json()) as CollectionPayload<ScenarioPack>;
      const packs = payload.data ?? [];
      setScenarioPacks(packs);
      setSelectedScenarioPackId((current) => {
        if (current && packs.some((pack) => pack.id === current)) {
          return current;
        }
        return packs[0]?.id ?? "";
      });
    } else {
      setScenarioPacks([]);
      setSelectedScenarioPackId("");
    }

    if (runsRes.ok) {
      const payload = (await runsRes.json()) as CollectionPayload<ScenarioRun>;
      setScenarioRuns(payload.data ?? []);
    } else {
      setScenarioRuns([]);
    }

    if (fixRes.ok) {
      const payload = (await fixRes.json()) as CollectionPayload<FixAttempt>;
      setFixAttempts(payload.data ?? []);
    } else {
      setFixAttempts([]);
    }

    if (prsRes.ok) {
      const payload = (await prsRes.json()) as CollectionPayload<PullRequestRecord>;
      setPullRequests(payload.data ?? []);
    } else {
      setPullRequests([]);
    }

    if (boardRes.ok) {
      const payload = (await boardRes.json()) as ReviewBoardPayload;
      setReviewBoard(payload.board);
    } else {
      setReviewBoard(null);
    }
  }, [resetProjectState]);

  return (
    <ProjectContext.Provider
      value={{
        projects,
        setProjects,
        selectedProjectId,
        setSelectedProjectId,
        githubConnection,
        setGithubConnection,
        githubRepos,
        setGithubRepos,
        sources,
        setSources,
        selectedSourceIds,
        setSelectedSourceIds,
        manifests,
        setManifests,
        scenarioPacks,
        setScenarioPacks,
        selectedScenarioPackId,
        setSelectedScenarioPackId,
        scenarioRuns,
        setScenarioRuns,
        fixAttempts,
        setFixAttempts,
        pullRequests,
        setPullRequests,
        reviewBoard,
        setReviewBoard,
        loadProjectData,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
};
