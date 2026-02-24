import { env } from "cloudflare:workers";
import type {
  AuthPrincipal,
  CodeBaseline,
  CodexSession,
  ExecutionJob,
  ExecutionJobEvent,
  FixAttempt,
  GitHubConnection,
  Project,
  ProjectPrReadiness,
  PullRequestRecord,
  ScenarioPack,
  ScenarioRun,
  SourceManifest,
  SourceRecord,
} from "@/domain/models";
import { hydrateCoreState } from "@/services/store";

const DURABLE_CORE_KEY = "__SCENARIOFORGE_DURABLE_CORE_STATE__";
const HYDRATE_TTL_MS = 3000;

interface DurableCoreState {
  tablesReady: boolean;
  lastHydratedAt: number;
}

interface HydrateCoreStateFromD1Options {
  force?: boolean;
}

interface ReconcilePrincipalIdentityInput {
  provider: AuthPrincipal["provider"];
  email: string;
  displayName: string;
}

const nowIso = () => new Date().toISOString();

const getState = (): DurableCoreState => {
  const host = globalThis as typeof globalThis & {
    [DURABLE_CORE_KEY]?: DurableCoreState;
  };

  if (!host[DURABLE_CORE_KEY]) {
    host[DURABLE_CORE_KEY] = {
      tablesReady: false,
      lastHydratedAt: 0,
    };
  }

  return host[DURABLE_CORE_KEY];
};

const getDb = (): D1Database | null => env.SCENARIOFORGE_DB ?? null;

const safeParseJson = <T>(raw: string, fallback: T): T => {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const ensureTables = async (db: D1Database): Promise<void> => {
  const state = getState();
  const ensureColumn = async (tableName: string, columnSql: string): Promise<void> => {
    try {
      await db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnSql}`).run();
    } catch {
      // Ignore when column already exists.
    }
  };

  if (state.tablesReady) {
    return;
  }

  await db
    .prepare(
      `
      CREATE TABLE IF NOT EXISTS sf_principals (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        display_name TEXT NOT NULL,
        email TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `,
    )
    .run();

  await db
    .prepare(
      `
      CREATE TABLE IF NOT EXISTS sf_projects (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        name TEXT NOT NULL,
        repo_url TEXT,
        default_branch TEXT NOT NULL,
        active_manifest_id TEXT,
        active_scenario_pack_id TEXT,
        active_scenario_run_id TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `,
    )
    .run();
  await ensureColumn("sf_projects", "active_manifest_id TEXT");
  await ensureColumn("sf_projects", "active_scenario_pack_id TEXT");
  await ensureColumn("sf_projects", "active_scenario_run_id TEXT");

  await db
    .prepare(
      `
      CREATE TABLE IF NOT EXISTS sf_codex_sessions (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        status TEXT NOT NULL,
        transport TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        initialize_request_json TEXT NOT NULL,
        thread_start_request_json TEXT NOT NULL,
        preferred_models_json TEXT NOT NULL
      )
    `,
    )
    .run();

  await db
    .prepare(
      `
      CREATE TABLE IF NOT EXISTS sf_auth_sessions (
        session_id TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `,
    )
    .run();

  await db
    .prepare(
      `
      CREATE TABLE IF NOT EXISTS sf_github_connections (
        id TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        status TEXT NOT NULL,
        account_login TEXT,
        installation_id INTEGER NOT NULL,
        access_token TEXT NOT NULL,
        access_token_expires_at TEXT,
        repositories_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `,
    )
    .run();

  await db
    .prepare(
      `
      CREATE TABLE IF NOT EXISTS sf_sources (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        repository_full_name TEXT NOT NULL,
        branch TEXT NOT NULL,
        head_commit_sha TEXT NOT NULL,
        last_commit_sha TEXT,
        path TEXT NOT NULL,
        title TEXT NOT NULL,
        type TEXT NOT NULL,
        last_modified_at TEXT NOT NULL,
        alignment_score REAL NOT NULL,
        is_conflicting INTEGER NOT NULL,
        relevance_score REAL NOT NULL,
        status TEXT NOT NULL,
        selected INTEGER NOT NULL,
        warnings_json TEXT NOT NULL,
        hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `,
    )
    .run();

  await db
    .prepare(
      `
      CREATE TABLE IF NOT EXISTS sf_source_manifests (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        repository_full_name TEXT NOT NULL,
        branch TEXT NOT NULL,
        head_commit_sha TEXT NOT NULL,
        source_ids_json TEXT NOT NULL,
        source_paths_json TEXT NOT NULL,
        source_hashes_json TEXT NOT NULL,
        status_counts_json TEXT NOT NULL,
        includes_stale INTEGER NOT NULL,
        includes_conflicts INTEGER NOT NULL,
        user_confirmed INTEGER NOT NULL,
        confirmation_note TEXT NOT NULL,
        confirmed_at TEXT,
        code_baseline_id TEXT NOT NULL,
        code_baseline_hash TEXT NOT NULL,
        code_baseline_generated_at TEXT NOT NULL,
        manifest_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `,
    )
    .run();

  await db
    .prepare(
      `
      CREATE TABLE IF NOT EXISTS sf_code_baselines (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        repository_full_name TEXT NOT NULL,
        branch TEXT NOT NULL,
        head_commit_sha TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        baseline_hash TEXT NOT NULL,
        route_map_json TEXT NOT NULL,
        api_surface_json TEXT NOT NULL,
        state_transitions_json TEXT NOT NULL,
        async_boundaries_json TEXT NOT NULL,
        domain_entities_json TEXT NOT NULL,
        integrations_json TEXT NOT NULL,
        error_paths_json TEXT NOT NULL,
        likely_failure_points_json TEXT NOT NULL,
        evidence_anchors_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `,
    )
    .run();

  await db
    .prepare(
      `
      CREATE TABLE IF NOT EXISTS sf_scenario_packs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        manifest_id TEXT NOT NULL,
        manifest_hash TEXT NOT NULL,
        repository_full_name TEXT NOT NULL,
        branch TEXT NOT NULL,
        head_commit_sha TEXT NOT NULL,
        source_ids_json TEXT NOT NULL,
        model TEXT NOT NULL,
        generation_audit_json TEXT NOT NULL,
        coverage_json TEXT NOT NULL,
        grouped_by_feature_json TEXT NOT NULL,
        grouped_by_outcome_json TEXT NOT NULL,
        scenarios_json TEXT NOT NULL,
        scenarios_markdown TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `,
    )
    .run();

  await db
    .prepare(
      `
      CREATE TABLE IF NOT EXISTS sf_scenario_runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        scenario_pack_id TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        items_json TEXT NOT NULL,
        summary_json TEXT NOT NULL,
        events_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `,
    )
    .run();

  await db
    .prepare(
      `
      CREATE TABLE IF NOT EXISTS sf_execution_jobs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        scenario_pack_id TEXT NOT NULL,
        execution_mode TEXT NOT NULL,
        status TEXT NOT NULL,
        user_instruction TEXT,
        constraints_json TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        run_id TEXT,
        fix_attempt_id TEXT,
        pull_request_ids_json TEXT NOT NULL,
        summary_json TEXT,
        execution_audit_json TEXT NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `,
    )
    .run();

  await db
    .prepare(
      `
      CREATE TABLE IF NOT EXISTS sf_execution_job_events (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        event TEXT NOT NULL,
        phase TEXT NOT NULL,
        status TEXT NOT NULL,
        message TEXT NOT NULL,
        scenario_id TEXT,
        stage TEXT,
        payload_json TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `,
    )
    .run();

  await db
    .prepare(
      `
      CREATE INDEX IF NOT EXISTS idx_sf_execution_job_events_job_seq
      ON sf_execution_job_events (job_id, sequence)
    `,
    )
    .run();

  await db
    .prepare(
      `
      CREATE TABLE IF NOT EXISTS sf_fix_attempts (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        scenario_run_id TEXT NOT NULL,
        failed_scenario_ids_json TEXT NOT NULL,
        probable_root_cause TEXT NOT NULL,
        patch_summary TEXT NOT NULL,
        impacted_files_json TEXT NOT NULL,
        model TEXT NOT NULL,
        status TEXT NOT NULL,
        rerun_summary_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `,
    )
    .run();

  await db
    .prepare(
      `
      CREATE TABLE IF NOT EXISTS sf_pull_requests (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        fix_attempt_id TEXT NOT NULL,
        scenario_ids_json TEXT NOT NULL,
        title TEXT NOT NULL,
        branch_name TEXT NOT NULL,
        url TEXT NOT NULL,
        status TEXT NOT NULL,
        root_cause_summary TEXT NOT NULL,
        rerun_evidence_run_id TEXT,
        rerun_evidence_summary_json TEXT,
        risk_notes_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `,
    )
    .run();

  await db
    .prepare(
      `
      CREATE TABLE IF NOT EXISTS sf_project_pr_readiness (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        repository_full_name TEXT,
        branch TEXT NOT NULL,
        status TEXT NOT NULL,
        capabilities_json TEXT NOT NULL,
        reasons_json TEXT NOT NULL,
        recommended_actions_json TEXT NOT NULL,
        checked_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `,
    )
    .run();

  state.tablesReady = true;
};

export const hydrateCoreStateFromD1 = async (
  options: HydrateCoreStateFromD1Options = {},
): Promise<void> => {
  const db = getDb();

  if (!db) {
    return;
  }

  await ensureTables(db);

  const state = getState();
  if (!options.force && Date.now() - state.lastHydratedAt < HYDRATE_TTL_MS) {
    return;
  }

  const principalRows = await db
    .prepare(
      `
      SELECT id, provider, display_name, email, created_at, updated_at
      FROM sf_principals
    `,
    )
    .all();
  const projectRows = await db
    .prepare(
      `
      SELECT
        id,
        owner_id,
        name,
        repo_url,
        default_branch,
        active_manifest_id,
        active_scenario_pack_id,
        active_scenario_run_id,
        status,
        created_at,
        updated_at
      FROM sf_projects
    `,
    )
    .all();
  const sessionRows = await db
    .prepare(
      `
      SELECT
        id,
        owner_id,
        project_id,
        status,
        transport,
        created_at,
        updated_at,
        initialize_request_json,
        thread_start_request_json,
        preferred_models_json
      FROM sf_codex_sessions
    `,
    )
    .all();
  const githubConnectionRows = await db
    .prepare(
      `
      SELECT
        id,
        principal_id,
        provider,
        status,
        account_login,
        installation_id,
        access_token,
        access_token_expires_at,
        repositories_json,
        created_at,
        updated_at
      FROM sf_github_connections
    `,
    )
    .all();
  const sourceRows = await db
    .prepare(
      `
      SELECT
        id,
        project_id,
        owner_id,
        repository_full_name,
        branch,
        head_commit_sha,
        last_commit_sha,
        path,
        title,
        type,
        last_modified_at,
        alignment_score,
        is_conflicting,
        relevance_score,
        status,
        selected,
        warnings_json,
        hash,
        created_at,
        updated_at
      FROM sf_sources
    `,
    )
    .all();
  const sourceManifestRows = await db
    .prepare(
      `
      SELECT
        id,
        project_id,
        owner_id,
        repository_full_name,
        branch,
        head_commit_sha,
        source_ids_json,
        source_paths_json,
        source_hashes_json,
        status_counts_json,
        includes_stale,
        includes_conflicts,
        user_confirmed,
        confirmation_note,
        confirmed_at,
        code_baseline_id,
        code_baseline_hash,
        code_baseline_generated_at,
        manifest_hash,
        created_at,
        updated_at
      FROM sf_source_manifests
    `,
    )
    .all();
  const codeBaselineRows = await db
    .prepare(
      `
      SELECT
        id,
        project_id,
        owner_id,
        repository_full_name,
        branch,
        head_commit_sha,
        generated_at,
        baseline_hash,
        route_map_json,
        api_surface_json,
        state_transitions_json,
        async_boundaries_json,
        domain_entities_json,
        integrations_json,
        error_paths_json,
        likely_failure_points_json,
        evidence_anchors_json,
        created_at,
        updated_at
      FROM sf_code_baselines
    `,
    )
    .all();
  const scenarioPackRows = await db
    .prepare(
      `
      SELECT
        id,
        project_id,
        owner_id,
        manifest_id,
        manifest_hash,
        repository_full_name,
        branch,
        head_commit_sha,
        source_ids_json,
        model,
        generation_audit_json,
        coverage_json,
        grouped_by_feature_json,
        grouped_by_outcome_json,
        scenarios_json,
        scenarios_markdown,
        created_at,
        updated_at
      FROM sf_scenario_packs
    `,
    )
    .all();
  const scenarioRunRows = await db
    .prepare(
      `
      SELECT
        id,
        project_id,
        owner_id,
        scenario_pack_id,
        status,
        started_at,
        completed_at,
        items_json,
        summary_json,
        events_json,
        created_at,
        updated_at
      FROM sf_scenario_runs
    `,
    )
    .all();
  const executionJobRows = await db
    .prepare(
      `
      SELECT
        id,
        project_id,
        owner_id,
        scenario_pack_id,
        execution_mode,
        status,
        user_instruction,
        constraints_json,
        started_at,
        completed_at,
        run_id,
        fix_attempt_id,
        pull_request_ids_json,
        summary_json,
        execution_audit_json,
        error,
        created_at,
        updated_at
      FROM sf_execution_jobs
    `,
    )
    .all();
  const executionJobEventRows = await db
    .prepare(
      `
      SELECT
        id,
        job_id,
        owner_id,
        project_id,
        sequence,
        event,
        phase,
        status,
        message,
        scenario_id,
        stage,
        payload_json,
        timestamp,
        created_at
      FROM sf_execution_job_events
    `,
    )
    .all();
  const fixAttemptRows = await db
    .prepare(
      `
      SELECT
        id,
        project_id,
        owner_id,
        scenario_run_id,
        failed_scenario_ids_json,
        probable_root_cause,
        patch_summary,
        impacted_files_json,
        model,
        status,
        rerun_summary_json,
        created_at,
        updated_at
      FROM sf_fix_attempts
    `,
    )
    .all();
  const pullRequestRows = await db
    .prepare(
      `
      SELECT
        id,
        project_id,
        owner_id,
        fix_attempt_id,
        scenario_ids_json,
        title,
        branch_name,
        url,
        status,
        root_cause_summary,
        rerun_evidence_run_id,
        rerun_evidence_summary_json,
        risk_notes_json,
        created_at,
        updated_at
      FROM sf_pull_requests
    `,
    )
    .all();
  const prReadinessRows = await db
    .prepare(
      `
      SELECT
        id,
        owner_id,
        project_id,
        repository_full_name,
        branch,
        status,
        capabilities_json,
        reasons_json,
        recommended_actions_json,
        checked_at,
        created_at,
        updated_at
      FROM sf_project_pr_readiness
    `,
    )
    .all();

  const principals: AuthPrincipal[] = (principalRows.results as Array<Record<string, unknown>>)
    .map((row) => ({
      id: String(row.id),
      provider: String(row.provider) as AuthPrincipal["provider"],
      displayName: String(row.display_name),
      email: row.email ? String(row.email) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }));

  const projects: Project[] = (projectRows.results as Array<Record<string, unknown>>).map(
    (row) => ({
      id: String(row.id),
      ownerId: String(row.owner_id),
      name: String(row.name),
      repoUrl: row.repo_url ? String(row.repo_url) : null,
      defaultBranch: String(row.default_branch),
      activeManifestId: row.active_manifest_id
        ? String(row.active_manifest_id)
        : null,
      activeScenarioPackId: row.active_scenario_pack_id
        ? String(row.active_scenario_pack_id)
        : null,
      activeScenarioRunId: row.active_scenario_run_id
        ? String(row.active_scenario_run_id)
        : null,
      status: String(row.status) as Project["status"],
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }),
  );

  const sessions: CodexSession[] = (sessionRows.results as Array<Record<string, unknown>>).map(
    (row) => ({
      id: String(row.id),
      ownerId: String(row.owner_id),
      projectId: String(row.project_id),
      status: String(row.status) as CodexSession["status"],
      transport: String(row.transport) as CodexSession["transport"],
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      initializeRequest: safeParseJson(
        String(row.initialize_request_json),
        {
          method: "initialize",
          id: 1,
          params: {},
        },
      ),
      threadStartRequest: safeParseJson(
        String(row.thread_start_request_json),
        {
          method: "thread/start",
          id: 2,
          params: {},
        },
      ),
      preferredModels: safeParseJson(String(row.preferred_models_json), {
        research: "codex spark",
        implementation: "gpt-5.3-xhigh",
      }),
    }),
  );
  const githubConnections: GitHubConnection[] = (
    githubConnectionRows.results as Array<Record<string, unknown>>
  ).map((row) => ({
    id: String(row.id),
    principalId: String(row.principal_id),
    provider: String(row.provider) as GitHubConnection["provider"],
    status: String(row.status) as GitHubConnection["status"],
    accountLogin: row.account_login ? String(row.account_login) : null,
    installationId: Number(row.installation_id),
    accessToken: String(row.access_token),
    accessTokenExpiresAt: row.access_token_expires_at
      ? String(row.access_token_expires_at)
      : null,
    repositories: safeParseJson(String(row.repositories_json), []),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }));
  const sources: SourceRecord[] = (sourceRows.results as Array<Record<string, unknown>>).map(
    (row) => ({
      id: String(row.id),
      projectId: String(row.project_id),
      ownerId: String(row.owner_id),
      repositoryFullName: String(row.repository_full_name),
      branch: String(row.branch),
      headCommitSha: String(row.head_commit_sha),
      lastCommitSha: row.last_commit_sha ? String(row.last_commit_sha) : null,
      path: String(row.path),
      title: String(row.title),
      type: String(row.type) as SourceRecord["type"],
      lastModifiedAt: String(row.last_modified_at),
      alignmentScore: Number(row.alignment_score),
      isConflicting: Boolean(row.is_conflicting),
      relevanceScore: Number(row.relevance_score),
      status: String(row.status) as SourceRecord["status"],
      selected: Boolean(row.selected),
      warnings: safeParseJson(String(row.warnings_json), []),
      hash: String(row.hash),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }),
  );
  const sourceManifests: SourceManifest[] = (
    sourceManifestRows.results as Array<Record<string, unknown>>
  ).map((row) => ({
    id: String(row.id),
    projectId: String(row.project_id),
    ownerId: String(row.owner_id),
    repositoryFullName: String(row.repository_full_name),
    branch: String(row.branch),
    headCommitSha: String(row.head_commit_sha),
    sourceIds: safeParseJson(String(row.source_ids_json), []),
    sourcePaths: safeParseJson(String(row.source_paths_json), []),
    sourceHashes: safeParseJson(String(row.source_hashes_json), []),
    statusCounts: safeParseJson(String(row.status_counts_json), {
      trusted: 0,
      suspect: 0,
      stale: 0,
      excluded: 0,
    }),
    includesStale: Boolean(row.includes_stale),
    includesConflicts: Boolean(row.includes_conflicts),
    userConfirmed: Boolean(row.user_confirmed),
    confirmationNote: String(row.confirmation_note ?? ""),
    confirmedAt: row.confirmed_at ? String(row.confirmed_at) : null,
    codeBaselineId: String(row.code_baseline_id),
    codeBaselineHash: String(row.code_baseline_hash),
    codeBaselineGeneratedAt: String(row.code_baseline_generated_at),
    manifestHash: String(row.manifest_hash),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }));
  const codeBaselines: CodeBaseline[] = (
    codeBaselineRows.results as Array<Record<string, unknown>>
  ).map((row) => ({
    id: String(row.id),
    projectId: String(row.project_id),
    ownerId: String(row.owner_id),
    repositoryFullName: String(row.repository_full_name),
    branch: String(row.branch),
    headCommitSha: String(row.head_commit_sha),
    generatedAt: String(row.generated_at),
    baselineHash: String(row.baseline_hash),
    routeMap: safeParseJson(String(row.route_map_json), []),
    apiSurface: safeParseJson(String(row.api_surface_json), []),
    stateTransitions: safeParseJson(String(row.state_transitions_json), []),
    asyncBoundaries: safeParseJson(String(row.async_boundaries_json), []),
    domainEntities: safeParseJson(String(row.domain_entities_json), []),
    integrations: safeParseJson(String(row.integrations_json), []),
    errorPaths: safeParseJson(String(row.error_paths_json), []),
    likelyFailurePoints: safeParseJson(String(row.likely_failure_points_json), []),
    evidenceAnchors: safeParseJson(String(row.evidence_anchors_json), []),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }));
  const scenarioPacks: ScenarioPack[] = (
    scenarioPackRows.results as Array<Record<string, unknown>>
  ).map((row) => ({
    id: String(row.id),
    projectId: String(row.project_id),
    ownerId: String(row.owner_id),
    manifestId: String(row.manifest_id),
    manifestHash: String(row.manifest_hash),
    repositoryFullName: String(row.repository_full_name),
    branch: String(row.branch),
    headCommitSha: String(row.head_commit_sha),
    sourceIds: safeParseJson(String(row.source_ids_json), []),
    model: String(row.model),
    generationAudit: safeParseJson(String(row.generation_audit_json), {
      transport: "codex-app-server",
      requestedSkill: "",
      usedSkill: null,
      skillAvailable: false,
      skillPath: null,
      threadId: "",
      turnId: "",
      turnStatus: "",
      cwd: "",
      generatedAt: String(row.created_at),
    }),
    coverage: safeParseJson(String(row.coverage_json), {
      personas: [],
      journeys: [],
      edgeBuckets: [],
      features: [],
      outcomes: [],
      assumptions: [],
      knownUnknowns: [],
      uncoveredGaps: [],
    }),
    groupedByFeature: safeParseJson(String(row.grouped_by_feature_json), {}),
    groupedByOutcome: safeParseJson(String(row.grouped_by_outcome_json), {}),
    scenarios: safeParseJson(String(row.scenarios_json), []),
    scenariosMarkdown: String(row.scenarios_markdown ?? ""),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }));
  const scenarioRuns: ScenarioRun[] = (
    scenarioRunRows.results as Array<Record<string, unknown>>
  ).map((row) => ({
    id: String(row.id),
    projectId: String(row.project_id),
    ownerId: String(row.owner_id),
    scenarioPackId: String(row.scenario_pack_id),
    status: String(row.status) as ScenarioRun["status"],
    startedAt: row.started_at ? String(row.started_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    items: safeParseJson(String(row.items_json), []),
    summary: safeParseJson(String(row.summary_json), {
      total: 0,
      passed: 0,
      failed: 0,
      blocked: 0,
    }),
    events: safeParseJson(String(row.events_json), []),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }));
  const executionJobs: ExecutionJob[] = (
    executionJobRows.results as Array<Record<string, unknown>>
  ).map((row) => ({
    id: String(row.id),
    projectId: String(row.project_id),
    ownerId: String(row.owner_id),
    scenarioPackId: String(row.scenario_pack_id),
    executionMode: String(row.execution_mode) as ExecutionJob["executionMode"],
    status: String(row.status) as ExecutionJob["status"],
    userInstruction: row.user_instruction ? String(row.user_instruction) : null,
    constraints: safeParseJson(String(row.constraints_json ?? "{}"), {}),
    startedAt: row.started_at ? String(row.started_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    runId: row.run_id ? String(row.run_id) : null,
    fixAttemptId: row.fix_attempt_id ? String(row.fix_attempt_id) : null,
    pullRequestIds: safeParseJson(String(row.pull_request_ids_json), []),
    summary: row.summary_json
      ? safeParseJson(String(row.summary_json), null)
      : null,
    executionAudit: safeParseJson(String(row.execution_audit_json ?? "{}"), {
      model: null,
      threadId: null,
      turnId: null,
      turnStatus: null,
      completedAt: null,
    }),
    error: row.error ? String(row.error) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }));
  const executionJobEvents: ExecutionJobEvent[] = (
    executionJobEventRows.results as Array<Record<string, unknown>>
  ).map((row) => ({
    id: String(row.id),
    jobId: String(row.job_id),
    ownerId: String(row.owner_id),
    projectId: String(row.project_id),
    sequence: Number(row.sequence ?? 0),
    event: String(row.event ?? ""),
    phase: String(row.phase ?? ""),
    status: String(row.status ?? "running") as ExecutionJobEvent["status"],
    message: String(row.message ?? ""),
    scenarioId: row.scenario_id ? String(row.scenario_id) : null,
    stage: row.stage
      ? (String(row.stage) as ExecutionJobEvent["stage"])
      : null,
    payload: safeParseJson(String(row.payload_json ?? "null"), null),
    timestamp: String(row.timestamp ?? row.created_at ?? nowIso()),
    createdAt: String(row.created_at),
  }));
  const fixAttempts: FixAttempt[] = (
    fixAttemptRows.results as Array<Record<string, unknown>>
  ).map((row) => ({
    id: String(row.id),
    projectId: String(row.project_id),
    ownerId: String(row.owner_id),
    scenarioRunId: String(row.scenario_run_id),
    failedScenarioIds: safeParseJson(String(row.failed_scenario_ids_json), []),
    probableRootCause: String(row.probable_root_cause ?? ""),
    patchSummary: String(row.patch_summary ?? ""),
    impactedFiles: safeParseJson(String(row.impacted_files_json), []),
    model: String(row.model ?? ""),
    status: String(row.status) as FixAttempt["status"],
    rerunSummary: row.rerun_summary_json
      ? safeParseJson(String(row.rerun_summary_json), null)
      : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }));
  const pullRequests: PullRequestRecord[] = (
    pullRequestRows.results as Array<Record<string, unknown>>
  ).map((row) => ({
    id: String(row.id),
    projectId: String(row.project_id),
    ownerId: String(row.owner_id),
    fixAttemptId: String(row.fix_attempt_id),
    scenarioIds: safeParseJson(String(row.scenario_ids_json), []),
    title: String(row.title ?? ""),
    branchName: String(row.branch_name ?? ""),
    url: String(row.url ?? ""),
    status: String(row.status) as PullRequestRecord["status"],
    rootCauseSummary: String(row.root_cause_summary ?? ""),
    rerunEvidenceRunId: row.rerun_evidence_run_id
      ? String(row.rerun_evidence_run_id)
      : null,
    rerunEvidenceSummary: row.rerun_evidence_summary_json
      ? safeParseJson(String(row.rerun_evidence_summary_json), null)
      : null,
    riskNotes: safeParseJson(String(row.risk_notes_json), []),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }));
  const projectPrReadinessChecks: ProjectPrReadiness[] = (
    prReadinessRows.results as Array<Record<string, unknown>>
  ).map((row) => ({
    id: String(row.id),
    ownerId: String(row.owner_id),
    projectId: String(row.project_id),
    repositoryFullName: row.repository_full_name
      ? String(row.repository_full_name)
      : null,
    branch: String(row.branch ?? "main"),
    status: String(row.status) as ProjectPrReadiness["status"],
    capabilities: safeParseJson(String(row.capabilities_json), {
      hasGitHubConnection: false,
      repositoryConfigured: false,
      repositoryAccessible: false,
      branchExists: false,
      canPush: false,
      canCreateBranch: false,
      canOpenPr: false,
      codexBridgeConfigured: false,
    }),
    reasons: safeParseJson(String(row.reasons_json), []),
    recommendedActions: safeParseJson(String(row.recommended_actions_json), []),
    checkedAt: String(row.checked_at ?? row.updated_at ?? nowIso()),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }));

  hydrateCoreState({
    principals,
    projects,
    sessions,
    githubConnections,
    sources,
    sourceManifests,
    codeBaselines,
    scenarioPacks,
    scenarioRuns,
    executionJobs,
    executionJobEvents,
    fixAttempts,
    pullRequests,
    projectPrReadinessChecks,
    mode: "replacePersisted",
  });

  state.lastHydratedAt = Date.now();
};

const selectPrincipalIdentityRows = async (
  db: D1Database,
  provider: AuthPrincipal["provider"],
  email: string,
): Promise<Array<Record<string, unknown>>> => {
  const rows = await db
    .prepare(
      `
      SELECT
        p.id,
        p.provider,
        p.display_name,
        p.email,
        p.created_at,
        p.updated_at,
        (
          SELECT COUNT(*)
          FROM sf_projects pr
          WHERE pr.owner_id = p.id
        ) AS project_count,
        (
          SELECT COUNT(*)
          FROM sf_codex_sessions cs
          WHERE cs.owner_id = p.id
        ) AS session_count,
        (
          SELECT COUNT(*)
          FROM sf_github_connections gh
          WHERE gh.principal_id = p.id
            AND gh.status = 'connected'
        ) AS github_count
      FROM sf_principals p
      WHERE p.provider = ?
        AND p.email = ?
      ORDER BY
        project_count DESC,
        github_count DESC,
        session_count DESC,
        p.created_at ASC,
        p.updated_at DESC
    `,
    )
    .bind(provider, email)
    .all();

  return rows.results as Array<Record<string, unknown>>;
};

const pickCanonicalPrincipalId = (
  rows: Array<Record<string, unknown>>,
): string | null => {
  if (rows.length === 0) {
    return null;
  }

  return String(rows[0]?.id ?? "") || null;
};

const dedupeGitHubConnectionsForPrincipal = async (
  db: D1Database,
  principalId: string,
): Promise<void> => {
  const rows = await db
    .prepare(
      `
      SELECT id, status, updated_at
      FROM sf_github_connections
      WHERE principal_id = ?
      ORDER BY
        CASE status
          WHEN 'connected' THEN 0
          ELSE 1
        END,
        updated_at DESC
    `,
    )
    .bind(principalId)
    .all();

  const records = rows.results as Array<Record<string, unknown>>;
  if (records.length <= 1) {
    return;
  }

  const keepId = String(records[0]?.id ?? "");
  if (!keepId) {
    return;
  }

  for (const row of records.slice(1)) {
    const rowId = String(row.id ?? "");
    if (!rowId) {
      continue;
    }

    await db
      .prepare(
        `
        DELETE FROM sf_github_connections
        WHERE id = ?
      `,
      )
      .bind(rowId)
      .run();
  }
};

const normalizeDisplayName = (value: string): string => value.trim() || "ChatGPT User";

export const reconcilePrincipalIdentityInD1 = async (
  input: ReconcilePrincipalIdentityInput,
): Promise<AuthPrincipal | null> => {
  const db = getDb();

  if (!db) {
    return null;
  }

  const normalizedEmail = input.email.trim().toLowerCase();
  if (!normalizedEmail) {
    return null;
  }

  await ensureTables(db);

  let rows = await selectPrincipalIdentityRows(db, input.provider, normalizedEmail);
  let canonicalId = pickCanonicalPrincipalId(rows);
  const timestamp = nowIso();

  if (!canonicalId) {
    canonicalId = `usr_${crypto.randomUUID()}`;
    await db
      .prepare(
        `
        INSERT INTO sf_principals (
          id, provider, display_name, email, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `,
      )
      .bind(
        canonicalId,
        input.provider,
        normalizeDisplayName(input.displayName),
        normalizedEmail,
        timestamp,
        timestamp,
      )
      .run();
    rows = await selectPrincipalIdentityRows(db, input.provider, normalizedEmail);
  }

  const canonical = rows.find((row) => String(row.id ?? "") === canonicalId) ?? rows[0];
  if (!canonical) {
    return null;
  }

  const targetDisplayName = normalizeDisplayName(input.displayName);
  const aliasIds = rows
    .map((row) => String(row.id ?? ""))
    .filter((id) => id.length > 0 && id !== canonicalId);
  const canonicalDisplayName = String(canonical.display_name ?? "").trim();

  if (aliasIds.length === 0 && canonicalDisplayName === targetDisplayName) {
    return {
      id: String(canonical.id),
      provider: String(canonical.provider) as AuthPrincipal["provider"],
      displayName: String(canonical.display_name),
      email: canonical.email ? String(canonical.email) : null,
      createdAt: String(canonical.created_at),
      updatedAt: String(canonical.updated_at),
    };
  }

  for (const aliasId of aliasIds) {
    await db
      .prepare(
        `
        UPDATE sf_projects
        SET owner_id = ?
        WHERE owner_id = ?
      `,
      )
      .bind(canonicalId, aliasId)
      .run();

    await db
      .prepare(
        `
        UPDATE sf_codex_sessions
        SET owner_id = ?
        WHERE owner_id = ?
      `,
      )
      .bind(canonicalId, aliasId)
      .run();

    await db
      .prepare(
        `
        UPDATE sf_auth_sessions
        SET principal_id = ?
        WHERE principal_id = ?
      `,
      )
      .bind(canonicalId, aliasId)
      .run();

    await db
      .prepare(
        `
        UPDATE sf_github_connections
        SET principal_id = ?
        WHERE principal_id = ?
      `,
      )
      .bind(canonicalId, aliasId)
      .run();

    await db
      .prepare(
        `
        UPDATE sf_sources
        SET owner_id = ?
        WHERE owner_id = ?
      `,
      )
      .bind(canonicalId, aliasId)
      .run();

    await db
      .prepare(
        `
        UPDATE sf_source_manifests
        SET owner_id = ?
        WHERE owner_id = ?
      `,
      )
      .bind(canonicalId, aliasId)
      .run();

    await db
      .prepare(
        `
        UPDATE sf_code_baselines
        SET owner_id = ?
        WHERE owner_id = ?
      `,
      )
      .bind(canonicalId, aliasId)
      .run();

    await db
      .prepare(
        `
        UPDATE sf_scenario_packs
        SET owner_id = ?
        WHERE owner_id = ?
      `,
      )
      .bind(canonicalId, aliasId)
      .run();

    await db
      .prepare(
        `
        UPDATE sf_scenario_runs
        SET owner_id = ?
        WHERE owner_id = ?
      `,
      )
      .bind(canonicalId, aliasId)
      .run();

    await db
      .prepare(
        `
        UPDATE sf_execution_jobs
        SET owner_id = ?
        WHERE owner_id = ?
      `,
      )
      .bind(canonicalId, aliasId)
      .run();

    await db
      .prepare(
        `
        UPDATE sf_execution_job_events
        SET owner_id = ?
        WHERE owner_id = ?
      `,
      )
      .bind(canonicalId, aliasId)
      .run();

    await db
      .prepare(
        `
        UPDATE sf_fix_attempts
        SET owner_id = ?
        WHERE owner_id = ?
      `,
      )
      .bind(canonicalId, aliasId)
      .run();

    await db
      .prepare(
        `
        UPDATE sf_pull_requests
        SET owner_id = ?
        WHERE owner_id = ?
      `,
      )
      .bind(canonicalId, aliasId)
      .run();

    await db
      .prepare(
        `
        UPDATE sf_project_pr_readiness
        SET owner_id = ?
        WHERE owner_id = ?
      `,
      )
      .bind(canonicalId, aliasId)
      .run();

    await db
      .prepare(
        `
        DELETE FROM sf_principals
        WHERE id = ?
      `,
      )
      .bind(aliasId)
      .run();
  }

  await dedupeGitHubConnectionsForPrincipal(db, canonicalId);

  await db
    .prepare(
      `
      UPDATE sf_principals
      SET display_name = ?, updated_at = ?
      WHERE id = ?
    `,
    )
    .bind(targetDisplayName, timestamp, canonicalId)
    .run();

  await hydrateCoreStateFromD1({ force: true });

  const finalRow = await db
    .prepare(
      `
      SELECT id, provider, display_name, email, created_at, updated_at
      FROM sf_principals
      WHERE id = ?
      LIMIT 1
    `,
    )
    .bind(canonicalId)
    .first<Record<string, unknown>>();

  if (!finalRow) {
    return null;
  }

  return {
    id: String(finalRow.id),
    provider: String(finalRow.provider) as AuthPrincipal["provider"],
    displayName: String(finalRow.display_name),
    email: finalRow.email ? String(finalRow.email) : null,
    createdAt: String(finalRow.created_at),
    updatedAt: String(finalRow.updated_at),
  };
};

export const persistPrincipalToD1 = async (
  principal: AuthPrincipal,
): Promise<void> => {
  const db = getDb();

  if (!db) {
    return;
  }

  await ensureTables(db);
  await db
    .prepare(
      `
      INSERT INTO sf_principals (
        id, provider, display_name, email, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        provider = excluded.provider,
        display_name = excluded.display_name,
        email = excluded.email,
        updated_at = excluded.updated_at
    `,
    )
    .bind(
      principal.id,
      principal.provider,
      principal.displayName,
      principal.email,
      principal.createdAt,
      principal.updatedAt || nowIso(),
    )
    .run();
};

export const persistProjectToD1 = async (project: Project): Promise<void> => {
  const db = getDb();

  if (!db) {
    return;
  }

  await ensureTables(db);
  await db
    .prepare(
      `
      INSERT INTO sf_projects (
        id,
        owner_id,
        name,
        repo_url,
        default_branch,
        active_manifest_id,
        active_scenario_pack_id,
        active_scenario_run_id,
        status,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        owner_id = excluded.owner_id,
        name = excluded.name,
        repo_url = excluded.repo_url,
        default_branch = excluded.default_branch,
        active_manifest_id = excluded.active_manifest_id,
        active_scenario_pack_id = excluded.active_scenario_pack_id,
        active_scenario_run_id = excluded.active_scenario_run_id,
        status = excluded.status,
        updated_at = excluded.updated_at
    `,
    )
    .bind(
      project.id,
      project.ownerId,
      project.name,
      project.repoUrl,
      project.defaultBranch,
      project.activeManifestId,
      project.activeScenarioPackId,
      project.activeScenarioRunId,
      project.status,
      project.createdAt,
      project.updatedAt || nowIso(),
    )
    .run();
};

export const persistCodexSessionToD1 = async (
  session: CodexSession,
): Promise<void> => {
  const db = getDb();

  if (!db) {
    return;
  }

  await ensureTables(db);
  await db
    .prepare(
      `
      INSERT INTO sf_codex_sessions (
        id,
        owner_id,
        project_id,
        status,
        transport,
        created_at,
        updated_at,
        initialize_request_json,
        thread_start_request_json,
        preferred_models_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        owner_id = excluded.owner_id,
        project_id = excluded.project_id,
        status = excluded.status,
        transport = excluded.transport,
        updated_at = excluded.updated_at,
        initialize_request_json = excluded.initialize_request_json,
        thread_start_request_json = excluded.thread_start_request_json,
        preferred_models_json = excluded.preferred_models_json
    `,
    )
    .bind(
      session.id,
      session.ownerId,
      session.projectId,
      session.status,
      session.transport,
      session.createdAt,
      session.updatedAt || nowIso(),
      JSON.stringify(session.initializeRequest),
      JSON.stringify(session.threadStartRequest),
      JSON.stringify(session.preferredModels),
    )
    .run();
};

export const persistGitHubConnectionToD1 = async (
  connection: GitHubConnection,
): Promise<void> => {
  const db = getDb();

  if (!db) {
    return;
  }

  await ensureTables(db);
  await db
    .prepare(
      `
      INSERT INTO sf_github_connections (
        id,
        principal_id,
        provider,
        status,
        account_login,
        installation_id,
        access_token,
        access_token_expires_at,
        repositories_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        principal_id = excluded.principal_id,
        provider = excluded.provider,
        status = excluded.status,
        account_login = excluded.account_login,
        installation_id = excluded.installation_id,
        access_token = excluded.access_token,
        access_token_expires_at = excluded.access_token_expires_at,
        repositories_json = excluded.repositories_json,
        updated_at = excluded.updated_at
    `,
    )
    .bind(
      connection.id,
      connection.principalId,
      connection.provider,
      connection.status,
      connection.accountLogin,
      connection.installationId,
      connection.accessToken,
      connection.accessTokenExpiresAt,
      JSON.stringify(connection.repositories),
      connection.createdAt,
      connection.updatedAt || nowIso(),
    )
    .run();
};

export const persistSourceRecordToD1 = async (
  source: SourceRecord,
): Promise<void> => {
  const db = getDb();

  if (!db) {
    return;
  }

  await ensureTables(db);
  await db
    .prepare(
      `
      INSERT INTO sf_sources (
        id,
        project_id,
        owner_id,
        repository_full_name,
        branch,
        head_commit_sha,
        last_commit_sha,
        path,
        title,
        type,
        last_modified_at,
        alignment_score,
        is_conflicting,
        relevance_score,
        status,
        selected,
        warnings_json,
        hash,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        project_id = excluded.project_id,
        owner_id = excluded.owner_id,
        repository_full_name = excluded.repository_full_name,
        branch = excluded.branch,
        head_commit_sha = excluded.head_commit_sha,
        last_commit_sha = excluded.last_commit_sha,
        path = excluded.path,
        title = excluded.title,
        type = excluded.type,
        last_modified_at = excluded.last_modified_at,
        alignment_score = excluded.alignment_score,
        is_conflicting = excluded.is_conflicting,
        relevance_score = excluded.relevance_score,
        status = excluded.status,
        selected = excluded.selected,
        warnings_json = excluded.warnings_json,
        hash = excluded.hash,
        updated_at = excluded.updated_at
    `,
    )
    .bind(
      source.id,
      source.projectId,
      source.ownerId,
      source.repositoryFullName,
      source.branch,
      source.headCommitSha,
      source.lastCommitSha,
      source.path,
      source.title,
      source.type,
      source.lastModifiedAt,
      source.alignmentScore,
      source.isConflicting ? 1 : 0,
      source.relevanceScore,
      source.status,
      source.selected ? 1 : 0,
      JSON.stringify(source.warnings),
      source.hash,
      source.createdAt,
      source.updatedAt || nowIso(),
    )
    .run();
};

export const persistSourceManifestToD1 = async (
  manifest: SourceManifest,
): Promise<void> => {
  const db = getDb();

  if (!db) {
    return;
  }

  await ensureTables(db);
  await db
    .prepare(
      `
      INSERT INTO sf_source_manifests (
        id,
        project_id,
        owner_id,
        repository_full_name,
        branch,
        head_commit_sha,
        source_ids_json,
        source_paths_json,
        source_hashes_json,
        status_counts_json,
        includes_stale,
        includes_conflicts,
        user_confirmed,
        confirmation_note,
        confirmed_at,
        code_baseline_id,
        code_baseline_hash,
        code_baseline_generated_at,
        manifest_hash,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        project_id = excluded.project_id,
        owner_id = excluded.owner_id,
        repository_full_name = excluded.repository_full_name,
        branch = excluded.branch,
        head_commit_sha = excluded.head_commit_sha,
        source_ids_json = excluded.source_ids_json,
        source_paths_json = excluded.source_paths_json,
        source_hashes_json = excluded.source_hashes_json,
        status_counts_json = excluded.status_counts_json,
        includes_stale = excluded.includes_stale,
        includes_conflicts = excluded.includes_conflicts,
        user_confirmed = excluded.user_confirmed,
        confirmation_note = excluded.confirmation_note,
        confirmed_at = excluded.confirmed_at,
        code_baseline_id = excluded.code_baseline_id,
        code_baseline_hash = excluded.code_baseline_hash,
        code_baseline_generated_at = excluded.code_baseline_generated_at,
        manifest_hash = excluded.manifest_hash,
        updated_at = excluded.updated_at
    `,
    )
    .bind(
      manifest.id,
      manifest.projectId,
      manifest.ownerId,
      manifest.repositoryFullName,
      manifest.branch,
      manifest.headCommitSha,
      JSON.stringify(manifest.sourceIds),
      JSON.stringify(manifest.sourcePaths),
      JSON.stringify(manifest.sourceHashes),
      JSON.stringify(manifest.statusCounts),
      manifest.includesStale ? 1 : 0,
      manifest.includesConflicts ? 1 : 0,
      manifest.userConfirmed ? 1 : 0,
      manifest.confirmationNote,
      manifest.confirmedAt,
      manifest.codeBaselineId,
      manifest.codeBaselineHash,
      manifest.codeBaselineGeneratedAt,
      manifest.manifestHash,
      manifest.createdAt,
      manifest.updatedAt || nowIso(),
    )
    .run();
};

export const persistCodeBaselineToD1 = async (
  baseline: CodeBaseline,
): Promise<void> => {
  const db = getDb();

  if (!db) {
    return;
  }

  await ensureTables(db);
  await db
    .prepare(
      `
      INSERT INTO sf_code_baselines (
        id,
        project_id,
        owner_id,
        repository_full_name,
        branch,
        head_commit_sha,
        generated_at,
        baseline_hash,
        route_map_json,
        api_surface_json,
        state_transitions_json,
        async_boundaries_json,
        domain_entities_json,
        integrations_json,
        error_paths_json,
        likely_failure_points_json,
        evidence_anchors_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        project_id = excluded.project_id,
        owner_id = excluded.owner_id,
        repository_full_name = excluded.repository_full_name,
        branch = excluded.branch,
        head_commit_sha = excluded.head_commit_sha,
        generated_at = excluded.generated_at,
        baseline_hash = excluded.baseline_hash,
        route_map_json = excluded.route_map_json,
        api_surface_json = excluded.api_surface_json,
        state_transitions_json = excluded.state_transitions_json,
        async_boundaries_json = excluded.async_boundaries_json,
        domain_entities_json = excluded.domain_entities_json,
        integrations_json = excluded.integrations_json,
        error_paths_json = excluded.error_paths_json,
        likely_failure_points_json = excluded.likely_failure_points_json,
        evidence_anchors_json = excluded.evidence_anchors_json,
        updated_at = excluded.updated_at
    `,
    )
    .bind(
      baseline.id,
      baseline.projectId,
      baseline.ownerId,
      baseline.repositoryFullName,
      baseline.branch,
      baseline.headCommitSha,
      baseline.generatedAt,
      baseline.baselineHash,
      JSON.stringify(baseline.routeMap),
      JSON.stringify(baseline.apiSurface),
      JSON.stringify(baseline.stateTransitions),
      JSON.stringify(baseline.asyncBoundaries),
      JSON.stringify(baseline.domainEntities),
      JSON.stringify(baseline.integrations),
      JSON.stringify(baseline.errorPaths),
      JSON.stringify(baseline.likelyFailurePoints),
      JSON.stringify(baseline.evidenceAnchors),
      baseline.createdAt,
      baseline.updatedAt || nowIso(),
    )
    .run();
};

export const persistScenarioPackToD1 = async (
  pack: ScenarioPack,
): Promise<void> => {
  const db = getDb();

  if (!db) {
    return;
  }

  await ensureTables(db);
  await db
    .prepare(
      `
      INSERT INTO sf_scenario_packs (
        id,
        project_id,
        owner_id,
        manifest_id,
        manifest_hash,
        repository_full_name,
        branch,
        head_commit_sha,
        source_ids_json,
        model,
        generation_audit_json,
        coverage_json,
        grouped_by_feature_json,
        grouped_by_outcome_json,
        scenarios_json,
        scenarios_markdown,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        project_id = excluded.project_id,
        owner_id = excluded.owner_id,
        manifest_id = excluded.manifest_id,
        manifest_hash = excluded.manifest_hash,
        repository_full_name = excluded.repository_full_name,
        branch = excluded.branch,
        head_commit_sha = excluded.head_commit_sha,
        source_ids_json = excluded.source_ids_json,
        model = excluded.model,
        generation_audit_json = excluded.generation_audit_json,
        coverage_json = excluded.coverage_json,
        grouped_by_feature_json = excluded.grouped_by_feature_json,
        grouped_by_outcome_json = excluded.grouped_by_outcome_json,
        scenarios_json = excluded.scenarios_json,
        scenarios_markdown = excluded.scenarios_markdown,
        updated_at = excluded.updated_at
    `,
    )
    .bind(
      pack.id,
      pack.projectId,
      pack.ownerId,
      pack.manifestId,
      pack.manifestHash,
      pack.repositoryFullName,
      pack.branch,
      pack.headCommitSha,
      JSON.stringify(pack.sourceIds),
      pack.model,
      JSON.stringify(pack.generationAudit),
      JSON.stringify(pack.coverage),
      JSON.stringify(pack.groupedByFeature),
      JSON.stringify(pack.groupedByOutcome),
      JSON.stringify(pack.scenarios),
      pack.scenariosMarkdown,
      pack.createdAt,
      pack.updatedAt || nowIso(),
    )
    .run();
};

export const persistScenarioRunToD1 = async (
  run: ScenarioRun,
): Promise<void> => {
  const db = getDb();

  if (!db) {
    return;
  }

  await ensureTables(db);
  await db
    .prepare(
      `
      INSERT INTO sf_scenario_runs (
        id,
        project_id,
        owner_id,
        scenario_pack_id,
        status,
        started_at,
        completed_at,
        items_json,
        summary_json,
        events_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        project_id = excluded.project_id,
        owner_id = excluded.owner_id,
        scenario_pack_id = excluded.scenario_pack_id,
        status = excluded.status,
        started_at = excluded.started_at,
        completed_at = excluded.completed_at,
        items_json = excluded.items_json,
        summary_json = excluded.summary_json,
        events_json = excluded.events_json,
        updated_at = excluded.updated_at
    `,
    )
    .bind(
      run.id,
      run.projectId,
      run.ownerId,
      run.scenarioPackId,
      run.status,
      run.startedAt,
      run.completedAt,
      JSON.stringify(run.items),
      JSON.stringify(run.summary),
      JSON.stringify(run.events),
      run.createdAt,
      run.updatedAt || nowIso(),
    )
    .run();
};

export const persistExecutionJobToD1 = async (
  job: ExecutionJob,
): Promise<void> => {
  const db = getDb();

  if (!db) {
    return;
  }

  await ensureTables(db);
  await db
    .prepare(
      `
      INSERT INTO sf_execution_jobs (
        id,
        project_id,
        owner_id,
        scenario_pack_id,
        execution_mode,
        status,
        user_instruction,
        constraints_json,
        started_at,
        completed_at,
        run_id,
        fix_attempt_id,
        pull_request_ids_json,
        summary_json,
        execution_audit_json,
        error,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        project_id = excluded.project_id,
        owner_id = excluded.owner_id,
        scenario_pack_id = excluded.scenario_pack_id,
        execution_mode = excluded.execution_mode,
        status = excluded.status,
        user_instruction = excluded.user_instruction,
        constraints_json = excluded.constraints_json,
        started_at = excluded.started_at,
        completed_at = excluded.completed_at,
        run_id = excluded.run_id,
        fix_attempt_id = excluded.fix_attempt_id,
        pull_request_ids_json = excluded.pull_request_ids_json,
        summary_json = excluded.summary_json,
        execution_audit_json = excluded.execution_audit_json,
        error = excluded.error,
        updated_at = excluded.updated_at
    `,
    )
    .bind(
      job.id,
      job.projectId,
      job.ownerId,
      job.scenarioPackId,
      job.executionMode,
      job.status,
      job.userInstruction,
      JSON.stringify(job.constraints ?? {}),
      job.startedAt,
      job.completedAt,
      job.runId,
      job.fixAttemptId,
      JSON.stringify(job.pullRequestIds ?? []),
      job.summary ? JSON.stringify(job.summary) : null,
      JSON.stringify(job.executionAudit ?? {}),
      job.error,
      job.createdAt,
      job.updatedAt || nowIso(),
    )
    .run();
};

export const persistExecutionJobEventToD1 = async (
  event: ExecutionJobEvent,
): Promise<void> => {
  const db = getDb();

  if (!db) {
    return;
  }

  await ensureTables(db);
  await db
    .prepare(
      `
      INSERT INTO sf_execution_job_events (
        id,
        job_id,
        owner_id,
        project_id,
        sequence,
        event,
        phase,
        status,
        message,
        scenario_id,
        stage,
        payload_json,
        timestamp,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        job_id = excluded.job_id,
        owner_id = excluded.owner_id,
        project_id = excluded.project_id,
        sequence = excluded.sequence,
        event = excluded.event,
        phase = excluded.phase,
        status = excluded.status,
        message = excluded.message,
        scenario_id = excluded.scenario_id,
        stage = excluded.stage,
        payload_json = excluded.payload_json,
        timestamp = excluded.timestamp,
        created_at = excluded.created_at
    `,
    )
    .bind(
      event.id,
      event.jobId,
      event.ownerId,
      event.projectId,
      event.sequence,
      event.event,
      event.phase,
      event.status,
      event.message,
      event.scenarioId,
      event.stage,
      JSON.stringify(event.payload),
      event.timestamp,
      event.createdAt,
    )
    .run();
};

export const persistFixAttemptToD1 = async (
  attempt: FixAttempt,
): Promise<void> => {
  const db = getDb();

  if (!db) {
    return;
  }

  await ensureTables(db);
  await db
    .prepare(
      `
      INSERT INTO sf_fix_attempts (
        id,
        project_id,
        owner_id,
        scenario_run_id,
        failed_scenario_ids_json,
        probable_root_cause,
        patch_summary,
        impacted_files_json,
        model,
        status,
        rerun_summary_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        project_id = excluded.project_id,
        owner_id = excluded.owner_id,
        scenario_run_id = excluded.scenario_run_id,
        failed_scenario_ids_json = excluded.failed_scenario_ids_json,
        probable_root_cause = excluded.probable_root_cause,
        patch_summary = excluded.patch_summary,
        impacted_files_json = excluded.impacted_files_json,
        model = excluded.model,
        status = excluded.status,
        rerun_summary_json = excluded.rerun_summary_json,
        updated_at = excluded.updated_at
    `,
    )
    .bind(
      attempt.id,
      attempt.projectId,
      attempt.ownerId,
      attempt.scenarioRunId,
      JSON.stringify(attempt.failedScenarioIds),
      attempt.probableRootCause,
      attempt.patchSummary,
      JSON.stringify(attempt.impactedFiles),
      attempt.model,
      attempt.status,
      attempt.rerunSummary ? JSON.stringify(attempt.rerunSummary) : null,
      attempt.createdAt,
      attempt.updatedAt || nowIso(),
    )
    .run();
};

export const persistPullRequestToD1 = async (
  record: PullRequestRecord,
): Promise<void> => {
  const db = getDb();

  if (!db) {
    return;
  }

  await ensureTables(db);
  await db
    .prepare(
      `
      INSERT INTO sf_pull_requests (
        id,
        project_id,
        owner_id,
        fix_attempt_id,
        scenario_ids_json,
        title,
        branch_name,
        url,
        status,
        root_cause_summary,
        rerun_evidence_run_id,
        rerun_evidence_summary_json,
        risk_notes_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        project_id = excluded.project_id,
        owner_id = excluded.owner_id,
        fix_attempt_id = excluded.fix_attempt_id,
        scenario_ids_json = excluded.scenario_ids_json,
        title = excluded.title,
        branch_name = excluded.branch_name,
        url = excluded.url,
        status = excluded.status,
        root_cause_summary = excluded.root_cause_summary,
        rerun_evidence_run_id = excluded.rerun_evidence_run_id,
        rerun_evidence_summary_json = excluded.rerun_evidence_summary_json,
        risk_notes_json = excluded.risk_notes_json,
        updated_at = excluded.updated_at
    `,
    )
    .bind(
      record.id,
      record.projectId,
      record.ownerId,
      record.fixAttemptId,
      JSON.stringify(record.scenarioIds),
      record.title,
      record.branchName,
      record.url,
      record.status,
      record.rootCauseSummary,
      record.rerunEvidenceRunId,
      record.rerunEvidenceSummary
        ? JSON.stringify(record.rerunEvidenceSummary)
        : null,
      JSON.stringify(record.riskNotes),
      record.createdAt,
      record.updatedAt || nowIso(),
    )
    .run();
};

export interface DeleteProjectExecutionHistoryD1Result {
  scenarioRuns: number;
  executionJobs: number;
  executionJobEvents: number;
  fixAttempts: number;
  pullRequests: number;
}

export const deleteProjectExecutionHistoryFromD1 = async (
  ownerId: string,
  projectId: string,
): Promise<DeleteProjectExecutionHistoryD1Result> => {
  const db = getDb();
  const emptyResult: DeleteProjectExecutionHistoryD1Result = {
    scenarioRuns: 0,
    executionJobs: 0,
    executionJobEvents: 0,
    fixAttempts: 0,
    pullRequests: 0,
  };

  if (!db) {
    return emptyResult;
  }

  await ensureTables(db);

  const eventsDeleted = await db
    .prepare(
      `
      DELETE FROM sf_execution_job_events
      WHERE owner_id = ? AND project_id = ?
    `,
    )
    .bind(ownerId, projectId)
    .run();

  const jobsDeleted = await db
    .prepare(
      `
      DELETE FROM sf_execution_jobs
      WHERE owner_id = ? AND project_id = ?
    `,
    )
    .bind(ownerId, projectId)
    .run();

  const fixAttemptsDeleted = await db
    .prepare(
      `
      DELETE FROM sf_fix_attempts
      WHERE owner_id = ? AND project_id = ?
    `,
    )
    .bind(ownerId, projectId)
    .run();

  const pullRequestsDeleted = await db
    .prepare(
      `
      DELETE FROM sf_pull_requests
      WHERE owner_id = ? AND project_id = ?
    `,
    )
    .bind(ownerId, projectId)
    .run();

  const runsDeleted = await db
    .prepare(
      `
      DELETE FROM sf_scenario_runs
      WHERE owner_id = ? AND project_id = ?
    `,
    )
    .bind(ownerId, projectId)
    .run();

  return {
    scenarioRuns: Number(runsDeleted.meta?.changes ?? 0),
    executionJobs: Number(jobsDeleted.meta?.changes ?? 0),
    executionJobEvents: Number(eventsDeleted.meta?.changes ?? 0),
    fixAttempts: Number(fixAttemptsDeleted.meta?.changes ?? 0),
    pullRequests: Number(pullRequestsDeleted.meta?.changes ?? 0),
  };
};

export const persistProjectPrReadinessToD1 = async (
  readiness: ProjectPrReadiness,
): Promise<void> => {
  const db = getDb();

  if (!db) {
    return;
  }

  await ensureTables(db);
  await db
    .prepare(
      `
      INSERT INTO sf_project_pr_readiness (
        id,
        owner_id,
        project_id,
        repository_full_name,
        branch,
        status,
        capabilities_json,
        reasons_json,
        recommended_actions_json,
        checked_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        owner_id = excluded.owner_id,
        project_id = excluded.project_id,
        repository_full_name = excluded.repository_full_name,
        branch = excluded.branch,
        status = excluded.status,
        capabilities_json = excluded.capabilities_json,
        reasons_json = excluded.reasons_json,
        recommended_actions_json = excluded.recommended_actions_json,
        checked_at = excluded.checked_at,
        updated_at = excluded.updated_at
    `,
    )
    .bind(
      readiness.id,
      readiness.ownerId,
      readiness.projectId,
      readiness.repositoryFullName,
      readiness.branch,
      readiness.status,
      JSON.stringify(readiness.capabilities),
      JSON.stringify(readiness.reasons),
      JSON.stringify(readiness.recommendedActions),
      readiness.checkedAt,
      readiness.createdAt,
      readiness.updatedAt || nowIso(),
    )
    .run();
};
