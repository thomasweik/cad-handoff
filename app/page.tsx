"use client";

import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();
const STORAGE_BUCKET = "cad-packages";
const SIGNED_URL_LIFETIME_SECONDS = 60 * 60;
const ALLOWED_EXTENSIONS = new Set(["zip", "prt", "asm", "step", "stp"]);

type DatabaseId = number | string;

type ProjectRecord = {
  id: DatabaseId;
  name: string;
  description: string | null;
  created_by: string;
  created_by_name: string;
  created_at: string;
};

type ProjectSummary = ProjectRecord & {
  activeBranchCount: number;
  totalVersionCount: number;
  primaryFileName: string | null;
  updatedAt: string;
};

type BranchRecord = {
  id: DatabaseId;
  project_id: DatabaseId;
  name: string;
  owner_id: string;
  owner_name: string;
  base_package_id: DatabaseId | null;
  branched_from_file_name: string | null;
  merged_at: string | null;
  created_at: string;
};

type PackageRecord = {
  id: DatabaseId;
  project_id: DatabaseId;
  branch_id: DatabaseId;
  file_name: string;
  storage_path: string;
  owner_name: string;
  description: string | null;
  is_primary: boolean;
  version_number: number;
  promoted_at: string | null;
  created_at: string;
};

type CadPackage = PackageRecord & {
  downloadUrl: string;
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;

  if (error && typeof error === "object" && "message" in error) {
    const message = typeof error.message === "string" ? error.message : "";
    const details =
      "details" in error && typeof error.details === "string" ? error.details : "";
    const hint = "hint" in error && typeof error.hint === "string" ? error.hint : "";

    return [message, details, hint].filter(Boolean).join(" ");
  }

  return "Something went wrong. Please try again.";
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(date);
}

function pluralize(count: number, singular: string) {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

export default function Home() {
  const [name, setName] = useState("");
  const [currentUser, setCurrentUser] = useState("");
  const [currentUserId, setCurrentUserId] = useState("");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectSummary | null>(null);
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [packages, setPackages] = useState<CadPackage[]>([]);
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [showBranchForm, setShowBranchForm] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [branchName, setBranchName] = useState("");
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [versionDescription, setVersionDescription] = useState("");
  const [isInitializing, setIsInitializing] = useState(true);
  const [isEntering, setIsEntering] = useState(false);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(false);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [isCreatingBranch, setIsCreatingBranch] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [mergingBranchId, setMergingBranchId] = useState<DatabaseId | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadPanelRef = useRef<HTMLElement>(null);

  const loadProjects = useCallback(async () => {
    setIsLoadingProjects(true);
    setErrorMessage("");

    try {
      const [projectResult, branchResult, packageResult] = await Promise.all([
        supabase
          .from("cad_projects")
          .select("id, name, description, created_by, created_by_name, created_at")
          .order("created_at", { ascending: false }),
        supabase.from("cad_branches").select("project_id, merged_at"),
        supabase
          .from("cad_packages")
          .select("project_id, file_name, is_primary, created_at")
          .order("created_at", { ascending: false }),
      ]);

      if (projectResult.error) throw projectResult.error;
      if (branchResult.error) throw branchResult.error;
      if (packageResult.error) throw packageResult.error;

      const projectRows = (projectResult.data ?? []) as ProjectRecord[];
      const branchRows = (branchResult.data ?? []) as Pick<
        BranchRecord,
        "project_id" | "merged_at"
      >[];
      const packageRows = (packageResult.data ?? []) as Pick<
        PackageRecord,
        "project_id" | "file_name" | "is_primary" | "created_at"
      >[];

      const summaries = projectRows.map((project) => {
        const projectBranches = branchRows.filter(
          (branch) => String(branch.project_id) === String(project.id),
        );
        const projectPackages = packageRows.filter(
          (cadPackage) => String(cadPackage.project_id) === String(project.id),
        );
        const primaryPackage = projectPackages.find((cadPackage) => cadPackage.is_primary);

        return {
          ...project,
          activeBranchCount: projectBranches.filter((branch) => !branch.merged_at).length,
          totalVersionCount: projectPackages.length,
          primaryFileName: primaryPackage?.file_name ?? null,
          updatedAt: projectPackages[0]?.created_at ?? project.created_at,
        };
      });

      setProjects(summaries);
      return summaries;
    } catch (error) {
      const message = getErrorMessage(error);
      const migrationHint = message.includes("cad_projects")
        ? " Apply the project workspace migration in Supabase first."
        : "";
      setErrorMessage(`Could not load project paths. ${message}${migrationHint}`);
      return null;
    } finally {
      setIsLoadingProjects(false);
    }
  }, []);

  const loadWorkspace = useCallback(async (project: ProjectSummary) => {
    setIsLoadingWorkspace(true);
    setErrorMessage("");

    try {
      const [branchResult, packageResult] = await Promise.all([
        supabase
          .from("cad_branches")
          .select(
            "id, project_id, name, owner_id, owner_name, base_package_id, branched_from_file_name, merged_at, created_at",
          )
          .eq("project_id", project.id)
          .order("created_at", { ascending: true }),
        supabase
          .from("cad_packages")
          .select(
            "id, project_id, branch_id, file_name, storage_path, owner_name, description, is_primary, version_number, promoted_at, created_at",
          )
          .eq("project_id", project.id)
          .order("created_at", { ascending: true }),
      ]);

      if (branchResult.error) throw branchResult.error;
      if (packageResult.error) throw packageResult.error;

      const packageRows = (packageResult.data ?? []) as PackageRecord[];
      const packagesWithUrls = await Promise.all(
        packageRows.map(async (cadPackage) => {
          const { data, error } = await supabase.storage
            .from(STORAGE_BUCKET)
            .createSignedUrl(cadPackage.storage_path, SIGNED_URL_LIFETIME_SECONDS);

          if (error) {
            throw new Error(
              `Could not create a download link for ${cadPackage.file_name}: ${error.message}`,
            );
          }

          return { ...cadPackage, downloadUrl: data.signedUrl };
        }),
      );

      setBranches((branchResult.data ?? []) as BranchRecord[]);
      setPackages(packagesWithUrls);
      return true;
    } catch (error) {
      setErrorMessage(`Could not load this project path. ${getErrorMessage(error)}`);
      return false;
    } finally {
      setIsLoadingWorkspace(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function restoreSession() {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;

        const username = data.session?.user.user_metadata.username;
        const userId = data.session?.user.id;

        if (
          isMounted &&
          userId &&
          typeof username === "string" &&
          username.trim()
        ) {
          setCurrentUser(username.trim());
          setCurrentUserId(userId);
          await loadProjects();
        }
      } catch (error) {
        if (isMounted) {
          setErrorMessage(`Could not restore your session. ${getErrorMessage(error)}`);
        }
      } finally {
        if (isMounted) setIsInitializing(false);
      }
    }

    void restoreSession();
    return () => {
      isMounted = false;
    };
  }, [loadProjects]);

  const primaryPackage = useMemo(
    () => packages.find((cadPackage) => cadPackage.is_primary) ?? null,
    [packages],
  );

  const primaryHistory = useMemo(
    () =>
      packages
        .filter((cadPackage) => cadPackage.promoted_at)
        .sort(
          (first, second) =>
            new Date(first.promoted_at ?? 0).getTime() -
            new Date(second.promoted_at ?? 0).getTime(),
        ),
    [packages],
  );

  const ownedActiveBranches = useMemo(
    () =>
      branches.filter(
        (branch) => branch.owner_id === currentUserId && branch.merged_at === null,
      ),
    [branches, currentUserId],
  );

  async function enterWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const username = name.trim();

    if (!username) {
      setErrorMessage("Enter your name to continue.");
      return;
    }

    setIsEntering(true);
    setErrorMessage("");

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;

      if (sessionData.session) {
        const { error } = await supabase.auth.updateUser({ data: { username } });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInAnonymously({
          options: { data: { username } },
        });
        if (error) throw error;
      }

      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) {
        throw userError ?? new Error("The anonymous session could not be created.");
      }

      setCurrentUser(username);
      setCurrentUserId(userData.user.id);
      await loadProjects();
    } catch (error) {
      setErrorMessage(`Could not enter the workspace. ${getErrorMessage(error)}`);
    } finally {
      setIsEntering(false);
    }
  }

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = projectName.trim();

    if (!trimmedName) {
      setErrorMessage("Give the new project path a name.");
      return;
    }

    setIsCreatingProject(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      const { data, error } = await supabase
        .from("cad_projects")
        .insert({
          name: trimmedName,
          description: projectDescription.trim() || null,
          created_by: currentUserId,
          created_by_name: currentUser,
        })
        .select("id, name, description, created_by, created_by_name, created_at")
        .single();

      if (error) throw error;

      const newProject: ProjectSummary = {
        ...(data as ProjectRecord),
        activeBranchCount: 0,
        totalVersionCount: 0,
        primaryFileName: null,
        updatedAt: (data as ProjectRecord).created_at,
      };

      setProjectName("");
      setProjectDescription("");
      setShowProjectForm(false);
      setSelectedProject(newProject);
      setBranches([]);
      setPackages([]);
      setBranchName(`${currentUser}'s branch`);
      setShowBranchForm(true);
      setStatusMessage(`${newProject.name} is ready. Create its first working branch.`);
      await loadProjects();
    } catch (error) {
      setErrorMessage(`Could not create the project path. ${getErrorMessage(error)}`);
    } finally {
      setIsCreatingProject(false);
    }
  }

  async function openProject(project: ProjectSummary) {
    setSelectedProject(project);
    setStatusMessage("");
    setErrorMessage("");
    setShowBranchForm(false);
    setBranchName(`${currentUser}'s branch`);
    setSelectedBranchId("");
    await loadWorkspace(project);
  }

  async function createBranch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProject) return;

    const trimmedName = branchName.trim();
    if (!trimmedName) {
      setErrorMessage("Give your branch a name.");
      return;
    }

    setIsCreatingBranch(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      const { data, error } = await supabase
        .from("cad_branches")
        .insert({
          project_id: selectedProject.id,
          name: trimmedName,
          owner_id: currentUserId,
          owner_name: currentUser,
          base_package_id: primaryPackage?.id ?? null,
          branched_from_file_name: primaryPackage?.file_name ?? null,
        })
        .select(
          "id, project_id, name, owner_id, owner_name, base_package_id, branched_from_file_name, merged_at, created_at",
        )
        .single();

      if (error) throw error;

      const newBranch = data as BranchRecord;
      setShowBranchForm(false);
      setBranchName(`${currentUser}'s branch`);
      setSelectedBranchId(String(newBranch.id));
      setStatusMessage(`${newBranch.name} created. Upload its first CAD version.`);
      await Promise.all([loadWorkspace(selectedProject), loadProjects()]);
      requestAnimationFrame(() =>
        uploadPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    } catch (error) {
      setErrorMessage(`Could not create the branch. ${getErrorMessage(error)}`);
    } finally {
      setIsCreatingBranch(false);
    }
  }

  function handleFileSelection(event: ChangeEvent<HTMLInputElement>) {
    setErrorMessage("");
    setStatusMessage("");
    setSelectedFile(event.target.files?.[0] ?? null);
  }

  function selectBranchForUpload(branch: BranchRecord) {
    setSelectedBranchId(String(branch.id));
    setErrorMessage("");
    setStatusMessage("");
    requestAnimationFrame(() =>
      uploadPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }

  async function uploadVersion() {
    if (!selectedProject) return;

    const branch = ownedActiveBranches.find(
      (candidate) => String(candidate.id) === selectedBranchId,
    );
    if (!branch) {
      setErrorMessage("Select one of your active branches first.");
      return;
    }

    if (!selectedFile) {
      setErrorMessage("Select a CAD package first.");
      return;
    }

    const extension = selectedFile.name.split(".").pop()?.toLowerCase() ?? "";
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      setErrorMessage("Choose a ZIP, PRT, ASM, STEP, or STP file.");
      return;
    }

    setIsUploading(true);
    setErrorMessage("");
    setStatusMessage("Uploading the new branch version…");
    let uploadedPath = "";

    try {
      const branchPackages = packages.filter(
        (cadPackage) => String(cadPackage.branch_id) === String(branch.id),
      );
      const nextVersion =
        Math.max(0, ...branchPackages.map((cadPackage) => cadPackage.version_number)) + 1;
      const safeFileName = selectedFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      uploadedPath = `${currentUserId}/${selectedProject.id}/${branch.id}/${crypto.randomUUID()}-${safeFileName}`;

      const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(uploadedPath, selectedFile, {
          cacheControl: "3600",
          contentType: selectedFile.type || "application/octet-stream",
          upsert: false,
        });
      if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

      const { error: insertError } = await supabase.from("cad_packages").insert({
        project_id: selectedProject.id,
        branch_id: branch.id,
        version_number: nextVersion,
        file_name: selectedFile.name,
        storage_path: uploadedPath,
        owner_name: currentUser,
        description: versionDescription.trim() || "No description provided",
        is_primary: false,
        promoted_at: null,
      });

      if (insertError) {
        await supabase.storage.from(STORAGE_BUCKET).remove([uploadedPath]);
        throw new Error(`Package record failed: ${insertError.message}`);
      }

      setSelectedFile(null);
      setVersionDescription("");
      if (fileInputRef.current) fileInputRef.current.value = "";

      const [workspaceLoaded] = await Promise.all([
        loadWorkspace(selectedProject),
        loadProjects(),
      ]);
      setStatusMessage(
        workspaceLoaded ? `${branch.name} version ${nextVersion} uploaded.` : "",
      );
    } catch (error) {
      setStatusMessage("");
      setErrorMessage(`Could not upload this version. ${getErrorMessage(error)}`);
    } finally {
      setIsUploading(false);
    }
  }

  async function mergeBranch(branch: BranchRecord) {
    if (!selectedProject) return;

    setMergingBranchId(branch.id);
    setErrorMessage("");
    setStatusMessage(`Merging ${branch.name} into the primary path…`);

    try {
      const { error } = await supabase.rpc("merge_cad_branch", {
        p_branch_id: branch.id,
      });
      if (error) throw error;

      const [workspaceLoaded] = await Promise.all([
        loadWorkspace(selectedProject),
        loadProjects(),
      ]);
      setStatusMessage(
        workspaceLoaded ? `${branch.name} is now the latest primary version.` : "",
      );
    } catch (error) {
      setStatusMessage("");
      setErrorMessage(`Could not merge this branch. ${getErrorMessage(error)}`);
    } finally {
      setMergingBranchId(null);
    }
  }

  function returnToProjects() {
    setSelectedProject(null);
    setBranches([]);
    setPackages([]);
    setErrorMessage("");
    setStatusMessage("");
    setShowBranchForm(false);
    setSelectedBranchId("");
    void loadProjects();
  }

  if (isInitializing) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#061a33] p-6 text-white">
        <p className="font-semibold" role="status">
          Loading CAD Handoff…
        </p>
      </main>
    );
  }

  if (!currentUser) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top_right,_#174a78_0,_#082441_36%,_#031426_100%)] p-6">
        <form
          className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl"
          onSubmit={enterWorkspace}
        >
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-700">
            LMCO-Navy Senior Design
          </p>
          <h1 className="mt-2 text-3xl font-bold text-slate-900">CAD Handoff</h1>
          <p className="mt-2 text-slate-600">Enter your name to access the project paths.</p>

          <label className="sr-only" htmlFor="username">
            Your name
          </label>
          <input
            id="username"
            className="mt-6 w-full rounded-lg border border-slate-300 px-4 py-3 text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            placeholder="Your name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={isEntering}
          />

          {errorMessage ? (
            <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">
              {errorMessage}
            </p>
          ) : null}

          <button
            className="mt-4 w-full rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            type="submit"
            disabled={isEntering}
          >
            {isEntering ? "Entering Workspace…" : "Enter Workspace"}
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_right,_#174a78_0,_#082441_34%,_#031426_100%)] px-5 py-7 text-slate-900 sm:px-8 sm:py-10">
      <div className={selectedProject ? "mx-auto max-w-[1500px]" : "mx-auto max-w-7xl"}>
        <header className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <button
              className="text-left text-white"
              onClick={selectedProject ? returnToProjects : undefined}
              type="button"
            >
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.22em] text-blue-200 sm:text-sm">
                LMCO-Navy Senior Design
              </p>
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">CAD Handoff</h1>
              <p className="mt-1 text-blue-100">Collaborative CAD Workspace</p>
            </button>
          </div>

          <div className="w-fit rounded-full bg-white px-4 py-2 shadow-lg ring-1 ring-white/70">
            Signed in as <strong>{currentUser}</strong>
          </div>
        </header>

        {errorMessage ? (
          <p
            className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700"
            role="alert"
          >
            {errorMessage}
          </p>
        ) : null}

        {statusMessage ? (
          <p
            className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-700"
            role="status"
          >
            {statusMessage}
          </p>
        ) : null}

        {!selectedProject ? (
          <ProjectDashboard
            projects={projects}
            isLoading={isLoadingProjects}
            showProjectForm={showProjectForm}
            projectName={projectName}
            projectDescription={projectDescription}
            isCreatingProject={isCreatingProject}
            onOpenProject={openProject}
            onShowProjectForm={() => {
              setShowProjectForm(true);
              setErrorMessage("");
              setStatusMessage("");
            }}
            onCancelProject={() => setShowProjectForm(false)}
            onProjectNameChange={setProjectName}
            onProjectDescriptionChange={setProjectDescription}
            onCreateProject={createProject}
          />
        ) : (
          <ProjectWorkspace
            project={selectedProject}
            branches={branches}
            packages={packages}
            primaryPackage={primaryPackage}
            primaryHistory={primaryHistory}
            currentUserId={currentUserId}
            ownedActiveBranches={ownedActiveBranches}
            selectedBranchId={selectedBranchId}
            branchName={branchName}
            versionDescription={versionDescription}
            showBranchForm={showBranchForm}
            isLoading={isLoadingWorkspace}
            isCreatingBranch={isCreatingBranch}
            isUploading={isUploading}
            mergingBranchId={mergingBranchId}
            fileInputRef={fileInputRef}
            uploadPanelRef={uploadPanelRef}
            onBack={returnToProjects}
            onShowBranchForm={() => {
              setShowBranchForm(true);
              setErrorMessage("");
              setStatusMessage("");
            }}
            onCancelBranch={() => setShowBranchForm(false)}
            onBranchNameChange={setBranchName}
            onCreateBranch={createBranch}
            onSelectBranch={setSelectedBranchId}
            onSelectBranchForUpload={selectBranchForUpload}
            onFileSelection={handleFileSelection}
            onVersionDescriptionChange={setVersionDescription}
            onUploadVersion={uploadVersion}
            onMergeBranch={mergeBranch}
          />
        )}
      </div>
    </main>
  );
}

type ProjectDashboardProps = {
  projects: ProjectSummary[];
  isLoading: boolean;
  showProjectForm: boolean;
  projectName: string;
  projectDescription: string;
  isCreatingProject: boolean;
  onOpenProject: (project: ProjectSummary) => void;
  onShowProjectForm: () => void;
  onCancelProject: () => void;
  onProjectNameChange: (value: string) => void;
  onProjectDescriptionChange: (value: string) => void;
  onCreateProject: (event: FormEvent<HTMLFormElement>) => void;
};

function ProjectDashboard({
  projects,
  isLoading,
  showProjectForm,
  projectName,
  projectDescription,
  isCreatingProject,
  onOpenProject,
  onShowProjectForm,
  onCancelProject,
  onProjectNameChange,
  onProjectDescriptionChange,
  onCreateProject,
}: ProjectDashboardProps) {
  return (
    <section className="mt-10">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-blue-200">
            Project paths
          </p>
          <h2 className="mt-2 text-3xl font-bold text-white">Choose a CAD session</h2>
          <p className="mt-2 max-w-2xl text-blue-100">
            Each tile has its own primary history and contributor branches.
          </p>
        </div>
        {isLoading ? (
          <p className="text-sm font-medium text-blue-100" role="status">
            Loading project paths…
          </p>
        ) : null}
      </div>

      {showProjectForm ? (
        <form
          className="mt-7 rounded-2xl border border-blue-200 bg-white p-6 shadow-sm"
          onSubmit={onCreateProject}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-xl font-bold">Create a new project path</h3>
              <p className="mt-1 text-sm text-slate-600">
                This creates an independent branch tree for a new CAD system.
              </p>
            </div>
            <button
              className="text-sm font-semibold text-slate-500 hover:text-slate-900"
              onClick={onCancelProject}
              type="button"
            >
              Cancel
            </button>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="text-sm font-semibold text-slate-700">
              Project name
              <input
                autoFocus
                className="mt-2 w-full rounded-lg border border-slate-300 px-4 py-3 font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                placeholder="Tunnel"
                value={projectName}
                onChange={(event) => onProjectNameChange(event.target.value)}
                disabled={isCreatingProject}
                maxLength={80}
              />
            </label>
            <label className="text-sm font-semibold text-slate-700">
              Description
              <input
                className="mt-2 w-full rounded-lg border border-slate-300 px-4 py-3 font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                placeholder="What is this system for?"
                value={projectDescription}
                onChange={(event) => onProjectDescriptionChange(event.target.value)}
                disabled={isCreatingProject}
              />
            </label>
          </div>

          <button
            className="mt-5 rounded-lg bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            type="submit"
            disabled={isCreatingProject}
          >
            {isCreatingProject ? "Creating Path…" : "Create Project Path"}
          </button>
        </form>
      ) : null}

      <div className="mt-7 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {!showProjectForm ? (
          <button
            className="group min-h-64 rounded-2xl border-2 border-dashed border-white/60 bg-white/10 p-7 text-left text-white shadow-sm backdrop-blur-sm transition hover:-translate-y-1 hover:border-white hover:bg-white/15 hover:shadow-xl"
            onClick={onShowProjectForm}
            type="button"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white text-3xl font-light text-[#082441] shadow-sm transition group-hover:scale-105">
              +
            </span>
            <span className="mt-8 block text-xl font-bold text-white">Create New Path</span>
            <span className="mt-2 block text-sm leading-6 text-blue-100">
              Start a separate CAD project with a fresh primary line and working branches.
            </span>
          </button>
        ) : null}

        {projects.map((project) => (
          <button
            className="group min-h-64 rounded-2xl border border-slate-200 bg-white p-7 text-left shadow-sm transition hover:-translate-y-1 hover:border-blue-300 hover:shadow-lg"
            key={project.id}
            onClick={() => onOpenProject(project)}
            type="button"
          >
            <span className="flex items-start justify-between gap-3">
              <span className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-bold uppercase tracking-wider text-white">
                CAD project
              </span>
              <span className="text-xl text-slate-400 transition group-hover:translate-x-1 group-hover:text-blue-600">
                →
              </span>
            </span>
            <span className="mt-7 block text-2xl font-bold">{project.name}</span>
            <span className="mt-2 line-clamp-2 block min-h-10 text-sm leading-5 text-slate-600">
              {project.description || "No project description yet."}
            </span>
            <span className="mt-6 block border-t border-slate-100 pt-4 text-sm text-slate-500">
              <strong className="font-semibold text-slate-700">
                {project.primaryFileName ?? "No primary yet"}
              </strong>
            </span>
            <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium text-slate-500">
              <span>{pluralize(project.activeBranchCount, "active branch")}</span>
              <span>{pluralize(project.totalVersionCount, "version")}</span>
              <span>Updated {formatDate(project.updatedAt)}</span>
            </span>
          </button>
        ))}
      </div>

      {!isLoading && projects.length === 0 && !showProjectForm ? (
        <p className="mt-6 text-center text-sm text-blue-100">
          No project paths yet. Create the first one above.
        </p>
      ) : null}
    </section>
  );
}

type ProjectWorkspaceProps = {
  project: ProjectSummary;
  branches: BranchRecord[];
  packages: CadPackage[];
  primaryPackage: CadPackage | null;
  primaryHistory: CadPackage[];
  currentUserId: string;
  ownedActiveBranches: BranchRecord[];
  selectedBranchId: string;
  branchName: string;
  versionDescription: string;
  showBranchForm: boolean;
  isLoading: boolean;
  isCreatingBranch: boolean;
  isUploading: boolean;
  mergingBranchId: DatabaseId | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  uploadPanelRef: React.RefObject<HTMLElement | null>;
  onBack: () => void;
  onShowBranchForm: () => void;
  onCancelBranch: () => void;
  onBranchNameChange: (value: string) => void;
  onCreateBranch: (event: FormEvent<HTMLFormElement>) => void;
  onSelectBranch: (value: string) => void;
  onSelectBranchForUpload: (branch: BranchRecord) => void;
  onFileSelection: (event: ChangeEvent<HTMLInputElement>) => void;
  onVersionDescriptionChange: (value: string) => void;
  onUploadVersion: () => void;
  onMergeBranch: (branch: BranchRecord) => void;
};

function ProjectWorkspace({
  project,
  branches,
  packages,
  primaryPackage,
  primaryHistory,
  currentUserId,
  ownedActiveBranches,
  selectedBranchId,
  branchName,
  versionDescription,
  showBranchForm,
  isLoading,
  isCreatingBranch,
  isUploading,
  mergingBranchId,
  fileInputRef,
  uploadPanelRef,
  onBack,
  onShowBranchForm,
  onCancelBranch,
  onBranchNameChange,
  onCreateBranch,
  onSelectBranch,
  onSelectBranchForUpload,
  onFileSelection,
  onVersionDescriptionChange,
  onUploadVersion,
  onMergeBranch,
}: ProjectWorkspaceProps) {
  return (
    <>
      <section className="mt-8 rounded-2xl border border-white/15 bg-[linear-gradient(135deg,_#0d3157_0%,_#061a33_100%)] px-6 py-7 text-white shadow-2xl sm:px-8">
        <button
          className="text-sm font-semibold text-blue-300 hover:text-white"
          onClick={onBack}
          type="button"
        >
          ← All project paths
        </button>
        <div className="mt-5 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-blue-400">
              Project branch tree
            </p>
            <h2 className="mt-2 text-3xl font-bold sm:text-4xl">{project.name}</h2>
            <p className="mt-3 max-w-3xl text-slate-300">
              {project.description || "No project description yet."}
            </p>
          </div>
          <div className="rounded-xl bg-white/10 px-5 py-4 ring-1 ring-white/15">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Current primary
            </p>
            <p className="mt-1 max-w-sm truncate font-semibold">
              {primaryPackage?.file_name ?? "Waiting for the first merge"}
            </p>
          </div>
        </div>
      </section>

      <section className="mt-7 rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-200 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-xl font-bold">Version tree</h3>
            <p className="mt-1 text-sm text-slate-600">
              Branches move left to right. Merged versions return to the primary path.
            </p>
          </div>
          <button
            className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
            onClick={onShowBranchForm}
            type="button"
          >
            + New Working Branch
          </button>
        </div>

        {showBranchForm ? (
          <form
            className="border-b border-blue-100 bg-blue-50 px-6 py-5"
            onSubmit={onCreateBranch}
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
              <label className="flex-1 text-sm font-semibold text-slate-700">
                Branch name
                <input
                  autoFocus
                  className="mt-2 w-full rounded-lg border border-blue-200 bg-white px-4 py-3 font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  value={branchName}
                  onChange={(event) => onBranchNameChange(event.target.value)}
                  disabled={isCreatingBranch}
                  maxLength={80}
                />
              </label>
              <div className="flex gap-3">
                <button
                  className="rounded-lg border border-slate-300 bg-white px-4 py-3 font-semibold hover:bg-slate-50"
                  onClick={onCancelBranch}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="rounded-lg bg-slate-900 px-5 py-3 font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
                  type="submit"
                  disabled={isCreatingBranch}
                >
                  {isCreatingBranch ? "Creating…" : "Create Branch"}
                </button>
              </div>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Starts from {primaryPackage?.file_name ?? "an empty primary path"}.
            </p>
          </form>
        ) : null}

        <div className="overflow-x-auto px-6 py-7">
          {isLoading ? (
            <p className="py-16 text-center font-medium text-slate-500" role="status">
              Loading the branch tree…
            </p>
          ) : (
            <VersionTreeGraph
              branches={branches}
              packages={packages}
              primaryHistory={primaryHistory}
              currentUserId={currentUserId}
              mergingBranchId={mergingBranchId}
              onSelectBranchForUpload={onSelectBranchForUpload}
              onMergeBranch={onMergeBranch}
            />
          )}
        </div>
      </section>

      <section
        className="mt-7 scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
        ref={uploadPanelRef}
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.16em] text-blue-600">
              New branch version
            </p>
            <h3 className="mt-1 text-2xl font-bold">Upload a working copy</h3>
          </div>
          <p className="text-sm text-slate-500">ZIP, PRT, ASM, STEP, or STP</p>
        </div>

        {ownedActiveBranches.length === 0 ? (
          <div className="mt-5 rounded-xl border-2 border-dashed border-slate-200 p-8 text-center">
            <p className="font-semibold">You do not have an active branch in this project.</p>
            <button
              className="mt-3 text-sm font-bold text-blue-600 hover:text-blue-700"
              onClick={onShowBranchForm}
              type="button"
            >
              Create your working branch →
            </button>
          </div>
        ) : (
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <label className="text-sm font-semibold text-slate-700">
              Upload to branch
              <select
                className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                value={selectedBranchId}
                onChange={(event) => onSelectBranch(event.target.value)}
                disabled={isUploading}
              >
                <option value="">Select your branch</option>
                {ownedActiveBranches.map((branch) => (
                  <option key={branch.id} value={String(branch.id)}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm font-semibold text-slate-700">
              CAD file
              <input
                ref={fileInputRef}
                className="mt-2 block w-full rounded-lg border border-slate-300 p-2.5 font-normal"
                type="file"
                accept=".zip,.prt,.asm,.step,.stp"
                onChange={onFileSelection}
                disabled={isUploading}
              />
            </label>

            <label className="text-sm font-semibold text-slate-700 lg:col-span-2">
              What changed?
              <textarea
                className="mt-2 w-full rounded-lg border border-slate-300 p-3 font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                placeholder="Describe this version"
                rows={3}
                value={versionDescription}
                onChange={(event) => onVersionDescriptionChange(event.target.value)}
                disabled={isUploading}
              />
            </label>

            <div className="lg:col-span-2">
              <button
                className="rounded-lg bg-slate-900 px-5 py-3 font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={onUploadVersion}
                type="button"
                disabled={isUploading}
              >
                {isUploading ? "Uploading Version…" : "Upload Branch Version"}
              </button>
            </div>
          </div>
        )}
      </section>
    </>
  );
}

const GRAPH_ROOT_LEFT = 36;
const GRAPH_ROOT_WIDTH = 160;
const GRAPH_NODE_WIDTH = 240;
const GRAPH_NODE_HEIGHT = 142;
const GRAPH_PRIMARY_TOP = 34;
const GRAPH_PRIMARY_CENTER_Y = GRAPH_PRIMARY_TOP + GRAPH_NODE_HEIGHT / 2;
const GRAPH_BRANCH_START_Y = 290;
const GRAPH_BRANCH_GAP = 230;
const GRAPH_BRANCH_NODE_OFFSET = 250;
const GRAPH_NODE_GAP = 300;

type BranchGraphLayout = {
  branch: BranchRecord;
  versions: CadPackage[];
  baseCenterX: number;
  centerY: number;
  nodeLefts: number[];
  mergeTargetCenterX: number | null;
};

type VersionTreeGraphProps = {
  branches: BranchRecord[];
  packages: CadPackage[];
  primaryHistory: CadPackage[];
  currentUserId: string;
  mergingBranchId: DatabaseId | null;
  onSelectBranchForUpload: (branch: BranchRecord) => void;
  onMergeBranch: (branch: BranchRecord) => void;
};

function VersionTreeGraph({
  branches,
  packages,
  primaryHistory,
  currentUserId,
  mergingBranchId,
  onSelectBranchForUpload,
  onMergeBranch,
}: VersionTreeGraphProps) {
  const rootCenterX = GRAPH_ROOT_LEFT + GRAPH_ROOT_WIDTH / 2;
  const primaryLeftById = new Map<string, number>();
  let previousPrimaryLeft = GRAPH_ROOT_LEFT;

  for (const [index, primaryVersion] of primaryHistory.entries()) {
    let primaryLeft = index === 0 ? 260 : previousPrimaryLeft + 330;
    const mergedBranch = branches.find((branch) => {
      if (!branch.merged_at) return false;
      const versions = packages
        .filter((cadPackage) => String(cadPackage.branch_id) === String(branch.id))
        .sort((first, second) => first.version_number - second.version_number);
      return String(versions.at(-1)?.id) === String(primaryVersion.id);
    });

    if (mergedBranch) {
      const versions = packages.filter(
        (cadPackage) => String(cadPackage.branch_id) === String(mergedBranch.id),
      );
      const baseLeft = mergedBranch.base_package_id
        ? primaryLeftById.get(String(mergedBranch.base_package_id))
        : undefined;
      const baseCenterX = baseLeft === undefined ? rootCenterX : baseLeft + GRAPH_NODE_WIDTH / 2;
      const finalBranchNodeLeft =
        baseCenterX +
        GRAPH_BRANCH_NODE_OFFSET +
        Math.max(0, versions.length - 1) * GRAPH_NODE_GAP;
      primaryLeft = Math.max(primaryLeft, finalBranchNodeLeft + GRAPH_NODE_GAP);
    }

    primaryLeftById.set(String(primaryVersion.id), primaryLeft);
    previousPrimaryLeft = primaryLeft;
  }

  const branchLayouts: BranchGraphLayout[] = branches.map((branch, branchIndex) => {
    const versions = packages
      .filter((cadPackage) => String(cadPackage.branch_id) === String(branch.id))
      .sort((first, second) => first.version_number - second.version_number);
    const exactBaseLeft = branch.base_package_id
      ? primaryLeftById.get(String(branch.base_package_id))
      : undefined;
    const filenameBase = [...primaryHistory]
      .reverse()
      .find((cadPackage) => cadPackage.file_name === branch.branched_from_file_name);
    const filenameBaseLeft = filenameBase
      ? primaryLeftById.get(String(filenameBase.id))
      : undefined;
    const baseLeft = exactBaseLeft ?? filenameBaseLeft;
    const baseCenterX = baseLeft === undefined ? rootCenterX : baseLeft + GRAPH_NODE_WIDTH / 2;
    const nodeLefts = versions.map(
      (_, versionIndex) =>
        baseCenterX + GRAPH_BRANCH_NODE_OFFSET + versionIndex * GRAPH_NODE_GAP,
    );
    const latestVersion = versions.at(-1);
    const mergeTargetLeft =
      branch.merged_at && latestVersion
        ? primaryLeftById.get(String(latestVersion.id))
        : undefined;

    return {
      branch,
      versions,
      baseCenterX,
      centerY: GRAPH_BRANCH_START_Y + branchIndex * GRAPH_BRANCH_GAP,
      nodeLefts,
      mergeTargetCenterX:
        mergeTargetLeft === undefined ? null : mergeTargetLeft + GRAPH_NODE_WIDTH / 2,
    };
  });

  const furthestPrimaryRight = Math.max(
    GRAPH_ROOT_LEFT + GRAPH_ROOT_WIDTH,
    ...[...primaryLeftById.values()].map((left) => left + GRAPH_NODE_WIDTH),
  );
  const furthestBranchRight = Math.max(
    GRAPH_ROOT_LEFT + GRAPH_ROOT_WIDTH,
    ...branchLayouts.flatMap((layout) =>
      layout.nodeLefts.length > 0
        ? [layout.nodeLefts.at(-1)! + GRAPH_NODE_WIDTH]
        : [layout.baseCenterX + GRAPH_BRANCH_NODE_OFFSET + GRAPH_NODE_WIDTH],
    ),
  );
  const canvasWidth = Math.max(940, furthestPrimaryRight, furthestBranchRight) + 80;
  const canvasHeight =
    branches.length > 0
      ? GRAPH_BRANCH_START_Y + (branches.length - 1) * GRAPH_BRANCH_GAP + 150
      : 330;
  const firstPrimaryLeft = primaryHistory[0]
    ? primaryLeftById.get(String(primaryHistory[0].id))
    : undefined;
  const firstPrimaryCenterX =
    firstPrimaryLeft === undefined
      ? rootCenterX + 300
      : firstPrimaryLeft + GRAPH_NODE_WIDTH / 2;

  return (
    <div className="min-w-[900px]">
      <div className="mb-4 flex flex-wrap items-center gap-5 text-xs font-semibold text-slate-600">
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-6 rounded-full bg-blue-500" /> Primary path
        </span>
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-6 rounded-full bg-amber-400" /> Active branch
        </span>
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-6 rounded-full bg-emerald-500" /> Merged branch
        </span>
      </div>

      <div
        className="relative rounded-xl bg-slate-50/80 ring-1 ring-slate-100"
        style={{ width: canvasWidth, height: canvasHeight }}
        role="img"
        aria-label="CAD version tree showing primary versions, branch origins, and merge paths"
      >
        <svg
          aria-hidden="true"
          className="absolute inset-0 h-full w-full"
          viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
        >
          <defs>
            <marker
              id="primary-arrow"
              markerHeight="8"
              markerWidth="8"
              orient="auto"
              refX="7"
              refY="4"
            >
              <path d="M0,0 L8,4 L0,8 Z" fill="#3b82f6" />
            </marker>
            <marker
              id="merge-arrow"
              markerHeight="8"
              markerWidth="8"
              orient="auto"
              refX="7"
              refY="4"
            >
              <path d="M0,0 L8,4 L0,8 Z" fill="#10b981" />
            </marker>
          </defs>

          <path
            d={`M ${rootCenterX} ${GRAPH_PRIMARY_CENTER_Y} H ${firstPrimaryCenterX}`}
            fill="none"
            markerEnd={primaryHistory.length > 0 ? "url(#primary-arrow)" : undefined}
            stroke="#3b82f6"
            strokeWidth="3"
          />
          {primaryHistory.slice(0, -1).map((primaryVersion, index) => {
            const currentLeft = primaryLeftById.get(String(primaryVersion.id))!;
            const nextVersion = primaryHistory[index + 1];
            const nextLeft = primaryLeftById.get(String(nextVersion.id))!;
            return (
              <path
                d={`M ${currentLeft + GRAPH_NODE_WIDTH / 2} ${GRAPH_PRIMARY_CENTER_Y} H ${nextLeft + GRAPH_NODE_WIDTH / 2}`}
                fill="none"
                key={`primary-line-${primaryVersion.id}`}
                markerEnd="url(#primary-arrow)"
                stroke="#3b82f6"
                strokeWidth="3"
              />
            );
          })}

          {branchLayouts.map((layout) => {
            const firstNodeCenterX =
              (layout.nodeLefts[0] ?? layout.baseCenterX + GRAPH_BRANCH_NODE_OFFSET) +
              GRAPH_NODE_WIDTH / 2;
            const lastNodeCenterX =
              (layout.nodeLefts.at(-1) ??
                layout.baseCenterX + GRAPH_BRANCH_NODE_OFFSET) +
              GRAPH_NODE_WIDTH / 2;
            const branchColor = layout.branch.merged_at ? "#10b981" : "#f59e0b";

            return (
              <g key={`branch-lines-${layout.branch.id}`}>
                <path
                  d={`M ${layout.baseCenterX} ${GRAPH_PRIMARY_CENTER_Y + GRAPH_NODE_HEIGHT / 2} V ${layout.centerY} H ${firstNodeCenterX}`}
                  fill="none"
                  stroke={branchColor}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="3"
                />
                {layout.versions.slice(0, -1).map((version, index) => (
                  <path
                    d={`M ${layout.nodeLefts[index] + GRAPH_NODE_WIDTH / 2} ${layout.centerY} H ${layout.nodeLefts[index + 1] + GRAPH_NODE_WIDTH / 2}`}
                    fill="none"
                    key={`branch-line-${version.id}`}
                    stroke={branchColor}
                    strokeWidth="3"
                  />
                ))}
                {layout.mergeTargetCenterX !== null ? (
                  <path
                    d={`M ${lastNodeCenterX} ${layout.centerY} H ${layout.mergeTargetCenterX} V ${GRAPH_PRIMARY_CENTER_Y + GRAPH_NODE_HEIGHT / 2}`}
                    fill="none"
                    markerEnd="url(#merge-arrow)"
                    stroke="#10b981"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="3"
                  />
                ) : null}
                <circle
                  cx={layout.baseCenterX}
                  cy={GRAPH_PRIMARY_CENTER_Y + GRAPH_NODE_HEIGHT / 2}
                  fill={branchColor}
                  r="5"
                  stroke="white"
                  strokeWidth="3"
                />
              </g>
            );
          })}
        </svg>

        <div
          className="absolute flex h-24 w-40 flex-col justify-center rounded-xl border-2 border-blue-300 bg-blue-50 px-4 shadow-sm"
          style={{ left: GRAPH_ROOT_LEFT, top: GRAPH_PRIMARY_CENTER_Y - 48 }}
        >
          <p className="text-[10px] font-bold uppercase tracking-wider text-blue-600">
            Project origin
          </p>
          <p className="mt-1 text-sm font-bold">Primary starts here</p>
        </div>

        {primaryHistory.map((cadPackage, index) => (
          <GraphVersionNode
            cadPackage={cadPackage}
            key={`primary-${cadPackage.id}-${cadPackage.promoted_at}`}
            label={`Primary ${index + 1}`}
            left={primaryLeftById.get(String(cadPackage.id))!}
            top={GRAPH_PRIMARY_TOP}
            tone="primary"
          />
        ))}

        {primaryHistory.length === 0 ? (
          <div
            className="absolute flex h-24 w-72 items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-white px-5 text-center text-sm text-slate-500"
            style={{ left: firstPrimaryCenterX - 36, top: GRAPH_PRIMARY_CENTER_Y - 48 }}
          >
            Merge a branch to establish the first primary version
          </div>
        ) : null}

        {branchLayouts.map((layout) => {
          const ownsBranch = layout.branch.owner_id === currentUserId;
          const canMerge =
            ownsBranch && !layout.branch.merged_at && layout.versions.length > 0;
          const labelLeft = layout.baseCenterX + 28;

          return (
            <div key={`branch-content-${layout.branch.id}`}>
              <div
                className={`absolute w-48 rounded-xl border-l-4 bg-white p-3 shadow-sm ${
                  layout.branch.merged_at ? "border-emerald-500" : "border-amber-400"
                }`}
                style={{ left: labelLeft, top: layout.centerY - 66 }}
              >
                <p
                  className={`text-[10px] font-bold uppercase tracking-wider ${
                    layout.branch.merged_at ? "text-emerald-600" : "text-amber-600"
                  }`}
                >
                  {layout.branch.merged_at ? "Merged branch" : "Working branch"}
                </p>
                <p className="mt-1 truncate text-sm font-bold" title={layout.branch.name}>
                  {layout.branch.name}
                </p>
                <p className="mt-1 truncate text-[11px] text-slate-500">
                  {layout.branch.owner_name}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {ownsBranch && !layout.branch.merged_at ? (
                    <button
                      className="rounded border border-slate-300 px-2 py-1 text-[10px] font-bold hover:bg-slate-50"
                      onClick={() => onSelectBranchForUpload(layout.branch)}
                      type="button"
                    >
                      Add version
                    </button>
                  ) : null}
                  {canMerge ? (
                    <button
                      className="rounded bg-emerald-600 px-2 py-1 text-[10px] font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
                      onClick={() => onMergeBranch(layout.branch)}
                      type="button"
                      disabled={mergingBranchId !== null}
                    >
                      {String(mergingBranchId) === String(layout.branch.id)
                        ? "Merging…"
                        : "Add to Primary"}
                    </button>
                  ) : null}
                </div>
              </div>

              {layout.versions.map((cadPackage, index) => (
                <GraphVersionNode
                  cadPackage={cadPackage}
                  key={`branch-${cadPackage.id}`}
                  label={`Version ${cadPackage.version_number}`}
                  left={layout.nodeLefts[index]}
                  top={layout.centerY - GRAPH_NODE_HEIGHT / 2}
                  tone={layout.branch.merged_at ? "merged" : "branch"}
                />
              ))}

              {layout.versions.length === 0 ? (
                <div
                  className="absolute flex h-20 w-60 items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-white px-4 text-center text-xs text-slate-500"
                  style={{
                    left: layout.baseCenterX + GRAPH_BRANCH_NODE_OFFSET,
                    top: layout.centerY - 40,
                  }}
                >
                  No versions uploaded yet
                </div>
              ) : null}

              {layout.branch.merged_at && layout.mergeTargetCenterX !== null ? (
                <span
                  className="absolute rounded-full bg-emerald-100 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700 ring-1 ring-emerald-200"
                  style={{
                    left: layout.mergeTargetCenterX - 70,
                    top: layout.centerY - 28,
                  }}
                >
                  Merged {formatDate(layout.branch.merged_at)}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GraphVersionNode({
  cadPackage,
  label,
  left,
  top,
  tone,
}: {
  cadPackage: CadPackage;
  label: string;
  left: number;
  top: number;
  tone: "primary" | "branch" | "merged";
}) {
  const toneClasses = {
    primary: "border-blue-400 text-blue-600",
    branch: "border-amber-300 text-amber-600",
    merged: "border-emerald-400 text-emerald-600",
  };

  return (
    <article
      className={`absolute h-[142px] w-60 rounded-xl border-2 bg-white p-4 shadow-md ${toneClasses[tone]} ${
        cadPackage.is_primary ? "ring-4 ring-blue-100" : ""
      }`}
      style={{ left, top }}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-bold uppercase tracking-wider">{label}</p>
        {cadPackage.is_primary ? (
          <span className="rounded-full bg-blue-100 px-2 py-1 text-[9px] font-bold uppercase text-blue-700">
            Current
          </span>
        ) : null}
      </div>
      <h5 className="mt-2 truncate text-sm font-bold text-slate-900" title={cadPackage.file_name}>
        {cadPackage.file_name}
      </h5>
      <p className="mt-1 line-clamp-2 min-h-8 text-[11px] leading-4 text-slate-500">
        {cadPackage.description || "No description provided"}
      </p>
      <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2 text-[11px]">
        <span className="max-w-28 truncate text-slate-500">{cadPackage.owner_name}</span>
        <a
          className="font-bold text-blue-600 hover:text-blue-700"
          href={cadPackage.downloadUrl}
          download={cadPackage.file_name}
        >
          Download
        </a>
      </div>
    </article>
  );
}
