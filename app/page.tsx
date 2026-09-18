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
const SUPABASE_FREE_STORAGE_BYTES = 1024 * 1024 * 1024;
const STORAGE_WARNING_BYTES = SUPABASE_FREE_STORAGE_BYTES * 0.8;
const ARCHIVE_MAX_BYTES = 250 * 1024 * 1024;

type DatabaseId = number | string;

type ProjectRecord = {
  id: DatabaseId;
  name: string;
  description: string | null;
  cad_software: string | null;
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
  cad_software: string | null;
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
  file_size: number | null;
  is_archived: boolean;
  archived_at: string | null;
  archive_name: string | null;
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

function formatFileSize(bytes: number) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} bytes`;
}

function safeArchiveName(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9._-]/g, "_") || "unnamed";
}

async function removeStorageFiles(paths: string[]) {
  for (let index = 0; index < paths.length; index += 100) {
    const { error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .remove(paths.slice(index, index + 100));

    if (error) throw error;
  }
}

export default function Home() {
  const [name, setName] = useState("");
  const [currentUser, setCurrentUser] = useState("");
  const [currentUserId, setCurrentUserId] = useState("");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectSummary | null>(null);
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [packages, setPackages] = useState<CadPackage[]>([]);
  const [storedFileBytes, setStoredFileBytes] = useState(0);
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [showExampleGuide, setShowExampleGuide] = useState(false);
  const [showBranchForm, setShowBranchForm] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [projectSoftware, setProjectSoftware] = useState("");
  const [branchName, setBranchName] = useState("");
  const [branchSoftware, setBranchSoftware] = useState("");
  const [branchBasePackageId, setBranchBasePackageId] = useState("");
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
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isExportingArchive, setIsExportingArchive] = useState(false);
  const [mergingBranchId, setMergingBranchId] = useState<DatabaseId | null>(null);
  const [deletingProjectId, setDeletingProjectId] = useState<DatabaseId | null>(null);
  const [deletingBranchId, setDeletingBranchId] = useState<DatabaseId | null>(null);
  const [renamingProjectId, setRenamingProjectId] = useState<DatabaseId | null>(null);
  const [renamingBranchId, setRenamingBranchId] = useState<DatabaseId | null>(null);
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
          .select(
            "id, name, description, cad_software, created_by, created_by_name, created_at",
          )
          .order("created_at", { ascending: false }),
        supabase.from("cad_branches").select("project_id, merged_at"),
        supabase
          .from("cad_packages")
          .select("project_id, file_name, is_primary, file_size, is_archived, created_at")
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
        | "project_id"
        | "file_name"
        | "is_primary"
        | "file_size"
        | "is_archived"
        | "created_at"
      >[];

      setStoredFileBytes(
        packageRows.reduce(
          (total, cadPackage) =>
            total + (cadPackage.is_archived ? 0 : Number(cadPackage.file_size ?? 0)),
          0,
        ),
      );

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
            "id, project_id, name, cad_software, owner_id, owner_name, base_package_id, branched_from_file_name, merged_at, created_at",
          )
          .eq("project_id", project.id)
          .order("created_at", { ascending: true }),
        supabase
          .from("cad_packages")
          .select(
            "id, project_id, branch_id, file_name, storage_path, owner_name, description, is_primary, version_number, promoted_at, file_size, is_archived, archived_at, archive_name, created_at",
          )
          .eq("project_id", project.id)
          .order("created_at", { ascending: true }),
      ]);

      if (branchResult.error) throw branchResult.error;
      if (packageResult.error) throw packageResult.error;

      const packageRows = (packageResult.data ?? []) as PackageRecord[];
      const packagesWithUrls = await Promise.all(
        packageRows.map(async (cadPackage) => {
          if (cadPackage.is_archived) {
            return { ...cadPackage, downloadUrl: "" };
          }

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

  const isAdmin = currentUser.trim().toLowerCase() === "admin";

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
    const trimmedSoftware = projectSoftware.trim();

    if (!trimmedName) {
      setErrorMessage("Give the new project path a name.");
      return;
    }

    if (!trimmedSoftware) {
      setErrorMessage("Enter the CAD software used for this project path.");
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
          cad_software: trimmedSoftware,
          created_by: currentUserId,
          created_by_name: currentUser,
        })
        .select(
          "id, name, description, cad_software, created_by, created_by_name, created_at",
        )
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
      setProjectSoftware("");
      setShowProjectForm(false);
      setSelectedProject(newProject);
      setBranches([]);
      setPackages([]);
      setBranchName(`${currentUser}'s branch`);
      setBranchSoftware(trimmedSoftware);
      setBranchBasePackageId("");
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
    setBranchSoftware(project.cad_software ?? "");
    setBranchBasePackageId(primaryPackage ? String(primaryPackage.id) : "");
    setSelectedBranchId("");
    await loadWorkspace(project);
  }

  async function createBranch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProject) return;

    const trimmedName = branchName.trim();
    const trimmedSoftware = branchSoftware.trim();
    const selectedBasePackage = branchBasePackageId
      ? packages.find(
          (cadPackage) => String(cadPackage.id) === branchBasePackageId,
        )
      : null;
    if (!trimmedName) {
      setErrorMessage("Give your branch a name.");
      return;
    }


    if (!trimmedSoftware) {
      setErrorMessage("Enter the CAD software used for this branch.");
      return;
    }

    if (branchBasePackageId && !selectedBasePackage) {
      setErrorMessage("Choose a valid version to branch from.");
      return;
    }

    if (selectedBasePackage?.is_archived) {
      setErrorMessage("That file is archived offline and cannot start a new branch.");
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
          cad_software: trimmedSoftware,
          owner_id: currentUserId,
          owner_name: currentUser,
          base_package_id: selectedBasePackage?.id ?? null,
          branched_from_file_name: selectedBasePackage?.file_name ?? null,
        })
        .select(
          "id, project_id, name, cad_software, owner_id, owner_name, base_package_id, branched_from_file_name, merged_at, created_at",
        )
        .single();

      if (error) throw error;

      const newBranch = data as BranchRecord;
      setShowBranchForm(false);
      setBranchName(`${currentUser}'s branch`);
      setBranchSoftware(selectedProject.cad_software ?? "");
      setBranchBasePackageId(primaryPackage ? String(primaryPackage.id) : "");
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
        file_size: selectedFile.size,
        is_archived: false,
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

  async function exportOldestFiles() {
    const confirmed = window.confirm(
      "Export up to 250 MB of the earliest eligible CAD files? After the ZIP is prepared and its download starts, those file copies will be removed from Supabase while their workflow history remains.",
    );
    if (!confirmed) return;

    setIsExportingArchive(true);
    setErrorMessage("");
    setStatusMessage("Finding the earliest files that are safe to archive…");
    let archiveDownloaded = false;

    try {
      const [packageResult, branchResult] = await Promise.all([
        supabase
          .from("cad_packages")
          .select(
            "id, project_id, branch_id, file_name, storage_path, owner_name, description, is_primary, version_number, promoted_at, file_size, is_archived, archived_at, archive_name, created_at",
          )
          .eq("is_archived", false)
          .order("created_at", { ascending: true }),
        supabase
          .from("cad_branches")
          .select("id, project_id, name, merged_at"),
      ]);
      if (packageResult.error) throw packageResult.error;
      if (branchResult.error) throw branchResult.error;

      const packageRows = (packageResult.data ?? []) as PackageRecord[];
      const branchRows = (branchResult.data ?? []) as Pick<
        BranchRecord,
        "id" | "project_id" | "name" | "merged_at"
      >[];
      const latestActivePackageIds = new Set<string>();

      for (const branch of branchRows.filter((candidate) => !candidate.merged_at)) {
        const latest = packageRows
          .filter((cadPackage) => String(cadPackage.branch_id) === String(branch.id))
          .sort((first, second) => second.version_number - first.version_number)[0];
        if (latest) latestActivePackageIds.add(String(latest.id));
      }

      const selectedPackages: PackageRecord[] = [];
      let selectedBytes = 0;
      for (const cadPackage of packageRows) {
        const size = Number(cadPackage.file_size ?? 0);
        const isProtected =
          cadPackage.is_primary || latestActivePackageIds.has(String(cadPackage.id));
        if (isProtected || size <= 0 || size > ARCHIVE_MAX_BYTES) continue;
        if (selectedBytes + size > ARCHIVE_MAX_BYTES) continue;
        selectedPackages.push(cadPackage);
        selectedBytes += size;
      }

      if (selectedPackages.length === 0) {
        throw new Error(
          "No eligible files were found. Current primary files and the newest version on each active branch are protected.",
        );
      }

      const archiveStamp = new Date().toISOString().replace(/[:.]/g, "-");
      const archiveName = `cad-handoff-archive-${archiveStamp}.zip`;
      const projectNames = new Map(
        projects.map((project) => [String(project.id), project.name]),
      );
      const branchNames = new Map(
        branchRows.map((branch) => [String(branch.id), branch.name]),
      );
      const manifest = {
        archive: archiveName,
        exported_at: new Date().toISOString(),
        total_files: selectedPackages.length,
        total_original_bytes: selectedBytes,
        files: selectedPackages.map((cadPackage) => ({
          package_id: cadPackage.id,
          project_id: cadPackage.project_id,
          project_name: projectNames.get(String(cadPackage.project_id)) ?? "Unknown project",
          branch_id: cadPackage.branch_id,
          branch_name: branchNames.get(String(cadPackage.branch_id)) ?? "Unknown branch",
          version_number: cadPackage.version_number,
          file_name: cadPackage.file_name,
          owner_name: cadPackage.owner_name,
          description: cadPackage.description,
          created_at: cadPackage.created_at,
          file_size: cadPackage.file_size,
        })),
      };
      const { downloadZip } = await import("client-zip");

      async function* archiveEntries() {
        yield {
          name: "manifest.json",
          input: JSON.stringify(manifest, null, 2),
          lastModified: new Date(),
        };

        for (const [index, cadPackage] of selectedPackages.entries()) {
          setStatusMessage(
            `Preparing archive file ${index + 1} of ${selectedPackages.length}…`,
          );
          const { data, error } = await supabase.storage
            .from(STORAGE_BUCKET)
            .createSignedUrl(cadPackage.storage_path, SIGNED_URL_LIFETIME_SECONDS);
          if (error) throw error;

          const response = await fetch(data.signedUrl);
          if (!response.ok) {
            throw new Error(`Could not download ${cadPackage.file_name} for the archive.`);
          }

          const projectFolder = safeArchiveName(
            projectNames.get(String(cadPackage.project_id)) ?? `project-${cadPackage.project_id}`,
          );
          const branchFolder = safeArchiveName(
            branchNames.get(String(cadPackage.branch_id)) ?? `branch-${cadPackage.branch_id}`,
          );
          yield {
            name: `files/${projectFolder}/${branchFolder}/v${cadPackage.version_number}-${safeArchiveName(cadPackage.file_name)}`,
            input: response,
            size: Number(cadPackage.file_size ?? 0),
            lastModified: new Date(cadPackage.created_at),
          };
        }
      }

      const archiveBlob = await downloadZip(archiveEntries()).blob();
      const archiveUrl = URL.createObjectURL(archiveBlob);
      const link = document.createElement("a");
      link.href = archiveUrl;
      link.download = archiveName;
      link.click();
      link.remove();
      archiveDownloaded = true;
      window.setTimeout(() => URL.revokeObjectURL(archiveUrl), 60_000);

      setStatusMessage("Archive ready. Removing the exported copies from Supabase…");
      const { error: archiveError } = await supabase.rpc("archive_cad_packages", {
        p_package_ids: selectedPackages.map((cadPackage) => String(cadPackage.id)),
        p_archive_name: archiveName,
      });
      if (archiveError) throw archiveError;

      await removeStorageFiles(
        selectedPackages.map((cadPackage) => cadPackage.storage_path),
      );
      await Promise.all([
        loadProjects(),
        selectedProject ? loadWorkspace(selectedProject) : Promise.resolve(true),
      ]);
      setStatusMessage(
        `${archiveName} downloaded. ${pluralize(selectedPackages.length, "file")} (${formatFileSize(selectedBytes)}) is now marked archived offline.`,
      );
    } catch (error) {
      setStatusMessage("");
      if (archiveDownloaded) {
        await Promise.all([
          loadProjects(),
          selectedProject ? loadWorkspace(selectedProject) : Promise.resolve(true),
        ]);
      }
      setErrorMessage(
        archiveDownloaded
          ? `The ZIP download started, but Supabase cleanup did not finish. ${getErrorMessage(error)}`
          : `Could not export the archive. ${getErrorMessage(error)}`,
      );
    } finally {
      setIsExportingArchive(false);
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

  async function renameProject(project: ProjectSummary) {
    const nextName = window.prompt("Rename this project path:", project.name)?.trim();
    if (!nextName || nextName === project.name) return;
    if (nextName.length > 80) {
      setErrorMessage("Project names must be 80 characters or fewer.");
      return;
    }

    setRenamingProjectId(project.id);
    setErrorMessage("");
    setStatusMessage(`Renaming ${project.name}…`);

    try {
      const { error } = await supabase
        .from("cad_projects")
        .update({ name: nextName })
        .eq("id", project.id)
        .select("id")
        .single();
      if (error) throw error;

      setSelectedProject((current) =>
        current && String(current.id) === String(project.id)
          ? { ...current, name: nextName }
          : current,
      );
      await loadProjects();
      setStatusMessage(`${project.name} was renamed to ${nextName}.`);
    } catch (error) {
      setStatusMessage("");
      setErrorMessage(`Could not rename this project path. ${getErrorMessage(error)}`);
    } finally {
      setRenamingProjectId(null);
    }
  }

  async function renameBranch(branch: BranchRecord) {
    if (!selectedProject) return;

    const nextName = window.prompt("Rename this branch:", branch.name)?.trim();
    if (!nextName || nextName === branch.name) return;
    if (nextName.length > 80) {
      setErrorMessage("Branch names must be 80 characters or fewer.");
      return;
    }

    setRenamingBranchId(branch.id);
    setErrorMessage("");
    setStatusMessage(`Renaming ${branch.name}…`);

    try {
      const { error } = await supabase
        .from("cad_branches")
        .update({ name: nextName })
        .eq("id", branch.id)
        .select("id")
        .single();
      if (error) throw error;

      await loadWorkspace(selectedProject);
      setStatusMessage(`${branch.name} was renamed to ${nextName}.`);
    } catch (error) {
      setStatusMessage("");
      setErrorMessage(`Could not rename this branch. ${getErrorMessage(error)}`);
    } finally {
      setRenamingBranchId(null);
    }
  }

  async function deleteProject(project: ProjectSummary) {
    const confirmed = window.confirm(
      `Delete “${project.name}”? This permanently removes its branches, package records, and uploaded CAD files.`,
    );
    if (!confirmed) return;

    setDeletingProjectId(project.id);
    setErrorMessage("");
    setStatusMessage(`Deleting ${project.name}…`);

    try {
      const { data: projectPackages, error: packageError } = await supabase
        .from("cad_packages")
        .select("storage_path")
        .eq("project_id", project.id);
      if (packageError) throw packageError;

      await removeStorageFiles(
        (projectPackages ?? []).map((cadPackage) => cadPackage.storage_path),
      );

      const { error: deleteError } = await supabase
        .from("cad_projects")
        .delete()
        .eq("id", project.id)
        .select("id")
        .single();
      if (deleteError) throw deleteError;

      await loadProjects();
      setStatusMessage(`${project.name} was deleted.`);
    } catch (error) {
      setStatusMessage("");
      setErrorMessage(`Could not delete this project path. ${getErrorMessage(error)}`);
    } finally {
      setDeletingProjectId(null);
    }
  }

  async function deleteBranch(branch: BranchRecord) {
    if (!selectedProject) return;

    const branchPackages = packages.filter(
      (cadPackage) => String(cadPackage.branch_id) === String(branch.id),
    );
    const primaryWarning = branchPackages.some((cadPackage) => cadPackage.is_primary)
      ? " This branch contains the current primary version, so the project will have no primary until another branch is added to it."
      : "";
    const confirmed = window.confirm(
      `Delete “${branch.name}”? This permanently removes the branch and all ${pluralize(branchPackages.length, "uploaded version")}.${primaryWarning}`,
    );
    if (!confirmed) return;

    setDeletingBranchId(branch.id);
    setErrorMessage("");
    setStatusMessage(`Deleting ${branch.name}…`);

    try {
      await removeStorageFiles(
        branchPackages.map((cadPackage) => cadPackage.storage_path),
      );

      const { error: deleteError } = await supabase
        .from("cad_branches")
        .delete()
        .eq("id", branch.id)
        .select("id")
        .single();
      if (deleteError) throw deleteError;

      if (selectedBranchId === String(branch.id)) setSelectedBranchId("");
      const [workspaceLoaded] = await Promise.all([
        loadWorkspace(selectedProject),
        loadProjects(),
      ]);
      setStatusMessage(workspaceLoaded ? `${branch.name} was deleted.` : "");
    } catch (error) {
      setStatusMessage("");
      setErrorMessage(`Could not delete this branch. ${getErrorMessage(error)}`);
    } finally {
      setDeletingBranchId(null);
    }
  }

  async function signOut() {
    const confirmed = window.confirm(
      "Sign out of this anonymous session? Re-entering the same name later will create a different user and will not restore ownership of your existing paths or branches.",
    );
    if (!confirmed) return;

    setIsSigningOut(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;

      setName("");
      setCurrentUser("");
      setCurrentUserId("");
      setProjects([]);
      setStoredFileBytes(0);
      setSelectedProject(null);
      setBranches([]);
      setPackages([]);
      setShowProjectForm(false);
      setShowExampleGuide(false);
      setShowBranchForm(false);
      setSelectedBranchId("");
      setSelectedFile(null);
      setVersionDescription("");
      setProjectSoftware("");
      setBranchSoftware("");
      setBranchBasePackageId("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (error) {
      setErrorMessage(`Could not sign out. ${getErrorMessage(error)}`);
    } finally {
      setIsSigningOut(false);
    }
  }

  function returnToProjects() {
    setSelectedProject(null);
    setBranches([]);
    setPackages([]);
    setErrorMessage("");
    setStatusMessage("");
    setShowBranchForm(false);
    setShowExampleGuide(false);
    setSelectedBranchId("");
    setBranchBasePackageId("");
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

          <div className="flex w-fit items-center gap-2 rounded-full bg-white p-1.5 pl-4 shadow-lg ring-1 ring-white/70">
            <span>
              Signed in as <strong>{currentUser}</strong>
              {isAdmin ? (
                <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-blue-700">
                  Admin
                </span>
              ) : null}
            </span>
            <button
              className="rounded-full bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={signOut}
              type="button"
              disabled={isSigningOut}
            >
              {isSigningOut ? "Signing out…" : "Sign out"}
            </button>
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
            currentUserId={currentUserId}
            isAdmin={isAdmin}
            isLoading={isLoadingProjects}
            storedFileBytes={storedFileBytes}
            isExportingArchive={isExportingArchive}
            showProjectForm={showProjectForm}
            showExampleGuide={showExampleGuide}
            projectName={projectName}
            projectDescription={projectDescription}
            projectSoftware={projectSoftware}
            isCreatingProject={isCreatingProject}
            deletingProjectId={deletingProjectId}
            renamingProjectId={renamingProjectId}
            onOpenProject={openProject}
            onRenameProject={renameProject}
            onDeleteProject={deleteProject}
            onExportOldestFiles={exportOldestFiles}
            onShowProjectForm={() => {
              setShowProjectForm(true);
              setShowExampleGuide(false);
              setErrorMessage("");
              setStatusMessage("");
            }}
            onShowExampleGuide={() => {
              setShowExampleGuide(true);
              setShowProjectForm(false);
            }}
            onCloseExampleGuide={() => setShowExampleGuide(false)}
            onCancelProject={() => setShowProjectForm(false)}
            onProjectNameChange={setProjectName}
            onProjectDescriptionChange={setProjectDescription}
            onProjectSoftwareChange={setProjectSoftware}
            onCreateProject={createProject}
          />
        ) : (
          <ProjectWorkspace
            key={selectedProject.id}
            project={selectedProject}
            branches={branches}
            packages={packages}
            primaryPackage={primaryPackage}
            primaryHistory={primaryHistory}
            currentUserId={currentUserId}
            isAdmin={isAdmin}
            ownedActiveBranches={ownedActiveBranches}
            selectedBranchId={selectedBranchId}
            branchName={branchName}
            branchSoftware={branchSoftware}
            branchBasePackageId={branchBasePackageId}
            versionDescription={versionDescription}
            showBranchForm={showBranchForm}
            isLoading={isLoadingWorkspace}
            isCreatingBranch={isCreatingBranch}
            isUploading={isUploading}
            mergingBranchId={mergingBranchId}
            deletingBranchId={deletingBranchId}
            renamingBranchId={renamingBranchId}
            fileInputRef={fileInputRef}
            uploadPanelRef={uploadPanelRef}
            onBack={returnToProjects}
            onShowBranchForm={() => {
              setShowBranchForm(true);
              setBranchSoftware(selectedProject.cad_software ?? "");
              setBranchBasePackageId(primaryPackage ? String(primaryPackage.id) : "");
              setErrorMessage("");
              setStatusMessage("");
            }}
            onShowBranchFromPackage={(cadPackage) => {
              setShowBranchForm(true);
              setBranchSoftware(selectedProject.cad_software ?? "");
              setBranchBasePackageId(String(cadPackage.id));
              setErrorMessage("");
              setStatusMessage(`Starting a new branch from ${cadPackage.file_name}.`);
            }}
            onCancelBranch={() => setShowBranchForm(false)}
            onBranchNameChange={setBranchName}
            onBranchSoftwareChange={setBranchSoftware}
            onBranchBasePackageIdChange={setBranchBasePackageId}
            onCreateBranch={createBranch}
            onSelectBranch={setSelectedBranchId}
            onSelectBranchForUpload={selectBranchForUpload}
            onFileSelection={handleFileSelection}
            onVersionDescriptionChange={setVersionDescription}
            onUploadVersion={uploadVersion}
            onMergeBranch={mergeBranch}
            onRenameBranch={renameBranch}
            onDeleteBranch={deleteBranch}
          />
        )}
      </div>
    </main>
  );
}

type ProjectDashboardProps = {
  projects: ProjectSummary[];
  currentUserId: string;
  isAdmin: boolean;
  isLoading: boolean;
  storedFileBytes: number;
  isExportingArchive: boolean;
  showProjectForm: boolean;
  showExampleGuide: boolean;
  projectName: string;
  projectDescription: string;
  projectSoftware: string;
  isCreatingProject: boolean;
  deletingProjectId: DatabaseId | null;
  renamingProjectId: DatabaseId | null;
  onOpenProject: (project: ProjectSummary) => void;
  onRenameProject: (project: ProjectSummary) => void;
  onDeleteProject: (project: ProjectSummary) => void;
  onExportOldestFiles: () => void;
  onShowProjectForm: () => void;
  onShowExampleGuide: () => void;
  onCloseExampleGuide: () => void;
  onCancelProject: () => void;
  onProjectNameChange: (value: string) => void;
  onProjectDescriptionChange: (value: string) => void;
  onProjectSoftwareChange: (value: string) => void;
  onCreateProject: (event: FormEvent<HTMLFormElement>) => void;
};

function ProjectDashboard({
  projects,
  currentUserId,
  isAdmin,
  isLoading,
  storedFileBytes,
  isExportingArchive,
  showProjectForm,
  showExampleGuide,
  projectName,
  projectDescription,
  projectSoftware,
  isCreatingProject,
  deletingProjectId,
  renamingProjectId,
  onOpenProject,
  onRenameProject,
  onDeleteProject,
  onExportOldestFiles,
  onShowProjectForm,
  onShowExampleGuide,
  onCloseExampleGuide,
  onCancelProject,
  onProjectNameChange,
  onProjectDescriptionChange,
  onProjectSoftwareChange,
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

      <div
        className={`mt-7 flex flex-col gap-4 rounded-2xl border p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between ${
          storedFileBytes >= STORAGE_WARNING_BYTES
            ? "border-amber-300 bg-amber-50"
            : "border-white/20 bg-white/10 text-white"
        }`}
      >
        <div>
          <p
            className={`text-xs font-bold uppercase tracking-wider ${
              storedFileBytes >= STORAGE_WARNING_BYTES ? "text-amber-700" : "text-blue-200"
            }`}
          >
            CAD file storage
          </p>
          <p className="mt-1 font-bold">
            {formatFileSize(storedFileBytes)} tracked in Supabase
          </p>
          <p
            className={`mt-1 text-sm ${
              storedFileBytes >= STORAGE_WARNING_BYTES ? "text-amber-800" : "text-blue-100"
            }`}
          >
            {storedFileBytes >= STORAGE_WARNING_BYTES
              ? "Storage is nearing the 1 GB free-plan limit. Export older files to free space."
              : "Export up to 250 MB of the earliest eligible files whenever you need more space."}
          </p>
        </div>
        <button
          className={`shrink-0 rounded-lg px-4 py-2.5 text-sm font-bold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${
            storedFileBytes >= STORAGE_WARNING_BYTES
              ? "bg-amber-600 text-white hover:bg-amber-700"
              : "bg-white text-[#082441] hover:bg-blue-50"
          }`}
          disabled={isExportingArchive}
          onClick={onExportOldestFiles}
          type="button"
        >
          {isExportingArchive ? "Building archive…" : "Export oldest files (.zip)"}
        </button>
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
            <label className="text-sm font-semibold text-slate-700 md:col-span-2">
              CAD software
              <input
                className="mt-2 w-full rounded-lg border border-slate-300 px-4 py-3 font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                placeholder="Creo, Fusion 360, SolidWorks…"
                value={projectSoftware}
                onChange={(event) => onProjectSoftwareChange(event.target.value)}
                disabled={isCreatingProject}
                maxLength={80}
                required
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

      {showExampleGuide ? (
        <ExamplePathGuide onClose={onCloseExampleGuide} />
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

        {!showExampleGuide ? (
          <button
            className="group min-h-64 rounded-2xl border border-blue-200 bg-blue-50 p-7 text-left text-slate-900 shadow-sm transition hover:-translate-y-1 hover:border-blue-400 hover:shadow-lg"
            onClick={onShowExampleGuide}
            type="button"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-xl font-bold text-white shadow-sm transition group-hover:scale-105">
              ?
            </span>
            <span className="mt-8 block text-xs font-bold uppercase tracking-wider text-blue-600">
              Example path
            </span>
            <span className="mt-2 block text-xl font-bold">How CAD Handoff works</span>
            <span className="mt-2 block text-sm leading-6 text-slate-600">
              Walk through the CAD handoff workflow step by step.
            </span>
          </button>
        ) : null}

        {projects.map((project) => (
          <article
            className="group relative min-h-64 rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-1 hover:border-blue-300 hover:shadow-lg"
            key={project.id}
          >
            <button
              className="block min-h-64 w-full p-7 text-left"
              onClick={() => onOpenProject(project)}
              type="button"
            >
              <span className="flex items-start justify-between gap-3">
                <span className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-bold uppercase tracking-wider text-white">
                  CAD project
                </span>
                <span
                  className={`text-xl text-slate-400 transition group-hover:translate-x-1 group-hover:text-blue-600 ${
                    project.created_by === currentUserId || isAdmin ? "mr-10" : ""
                  }`}
                >
                  →
                </span>
              </span>
              <span className="mt-7 block text-2xl font-bold">{project.name}</span>
              <span className="mt-2 inline-flex rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700 ring-1 ring-blue-100">
                {project.cad_software || "CAD software not specified"}
              </span>
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

            {project.created_by === currentUserId || isAdmin ? (
              <details className="absolute right-5 top-5 z-10">
                <summary
                  aria-label={`More options for ${project.name}`}
                  className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-full border border-slate-200 bg-white text-xl font-bold tracking-widest text-slate-500 shadow-sm hover:bg-slate-100 hover:text-slate-900 [&::-webkit-details-marker]:hidden"
                >
                  ⋯
                </summary>
                <div className="absolute right-0 mt-2 w-44 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
                  <button
                    className="w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                    onClick={() => onRenameProject(project)}
                    type="button"
                    disabled={renamingProjectId !== null || deletingProjectId !== null}
                  >
                    {String(renamingProjectId) === String(project.id)
                      ? "Renaming…"
                      : "Rename project"}
                  </button>
                  <button
                    className="w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60"
                    onClick={() => onDeleteProject(project)}
                    type="button"
                    disabled={deletingProjectId !== null}
                  >
                    {String(deletingProjectId) === String(project.id)
                      ? "Deleting…"
                      : "Delete project"}
                  </button>
                </div>
              </details>
            ) : null}
          </article>
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

function ExamplePathGuide({ onClose }: { onClose: () => void }) {
  const [currentStep, setCurrentStep] = useState(0);
  const steps = [
    {
      title: "Create a project path",
      text: "Start a workspace for one CAD system. Give it a clear name, description, and CAD software.",
      targetX: 98,
    },
    {
      title: "Create your working branch",
      text: "Branch from the latest primary model, then identify the contributor and software used on that branch.",
      targetX: 392,
    },
    {
      title: "Upload versions",
      text: "Add ZIP, PRT, ASM, STEP, or STP files. Every upload becomes the next numbered version on that branch.",
      targetX: 650,
    },
    {
      title: "Review the tree",
      text: "Use Go to current, Primary only, or Collapse branch to navigate large handoff histories.",
      targetX: 790,
    },
    {
      title: "Add the agreed version to Primary",
      text: "The latest branch version reconnects to the blue primary path and becomes the current model.",
      targetX: 1022,
    },
  ];
  const step = steps[currentStep];
  const nodeClass = (stepIndex: number, color: string) =>
    `absolute w-44 rounded-xl border-2 p-4 shadow-sm transition ${color} ${
      currentStep === stepIndex ? "scale-105 ring-4 ring-blue-400/40" : "opacity-70"
    }`;

  return (
    <div
      aria-labelledby="example-guide-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
      role="dialog"
    >
      <section className="max-h-[94vh] w-full max-w-6xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5 sm:px-8">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">
              Example path · Step {currentStep + 1} of {steps.length}
            </p>
            <h3 className="mt-1 text-2xl font-bold" id="example-guide-title">
              Walk through the CAD handoff workflow
            </h3>
          </div>
          <button
            aria-label="Close example walkthrough"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-300 text-xl text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>

        <div className="max-h-[calc(94vh-170px)] overflow-auto p-6 sm:p-8">
          <div className="overflow-x-auto rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
            <div className="relative h-[390px] w-[1140px]">
              <svg aria-hidden="true" className="absolute inset-0" height="390" width="1140">
                <path d="M 186 94 H 260" fill="none" stroke="#3b82f6" strokeWidth="4" />
                <path d="M 436 94 H 946" fill="none" stroke="#3b82f6" strokeWidth="4" />
                <path d="M 348 140 V 270 H 560" fill="none" stroke="#f59e0b" strokeWidth="4" />
                <path d="M 736 270 H 776" fill="none" stroke="#f59e0b" strokeWidth="4" />
                <path d="M 952 270 H 1034 V 140" fill="none" stroke="#10b981" strokeWidth="4" />
              </svg>

              <div
                className="absolute top-0 z-20 -translate-x-1/2 text-center text-blue-600 transition-all duration-300"
                style={{ left: step.targetX }}
              >
                <span className="rounded-full bg-blue-600 px-3 py-1 text-xs font-bold text-white shadow-lg">
                  Step {currentStep + 1}
                </span>
                <span className="block text-4xl font-black leading-8">↓</span>
              </div>

              <div className={nodeClass(0, "border-blue-300 bg-blue-50")} style={{ left: 10, top: 60 }}>
                <p className="text-xs font-bold uppercase text-blue-600">Project origin</p>
                <p className="mt-1 font-bold">Create project path</p>
                <p className="mt-1 text-xs text-slate-500">Project CAD software</p>
              </div>
              <div
                className="absolute w-44 rounded-xl border-2 border-blue-300 bg-blue-50 p-4 opacity-70 shadow-sm"
                style={{ left: 260, top: 60 }}
              >
                <p className="text-xs font-bold uppercase text-blue-600">Primary 1</p>
                <p className="mt-1 font-bold">baseline_model.step</p>
                <p className="mt-1 text-xs text-slate-500">Current approved model</p>
              </div>
              <div className={nodeClass(4, "border-emerald-300 bg-emerald-50")} style={{ left: 946, top: 60 }}>
                <p className="text-xs font-bold uppercase text-emerald-700">Primary 2 · Current</p>
                <p className="mt-1 font-bold">accepted_model.step</p>
                <p className="mt-1 text-xs text-slate-500">Merged from branch</p>
              </div>
              <div className={nodeClass(1, "border-amber-300 bg-amber-50")} style={{ left: 304, top: 225 }}>
                <p className="text-xs font-bold uppercase text-amber-700">Working branch</p>
                <p className="mt-1 font-bold">Contributor branch</p>
                <p className="mt-1 text-xs text-slate-500">Branch CAD software</p>
              </div>
              <div className={nodeClass(2, "border-amber-300 bg-amber-50")} style={{ left: 560, top: 235 }}>
                <p className="text-xs font-bold uppercase text-amber-700">Version 1</p>
                <p className="mt-1 font-bold">working_copy.step</p>
                <p className="mt-1 text-xs text-slate-500">Upload and describe</p>
              </div>
              <div className={nodeClass(3, "border-amber-300 bg-amber-50")} style={{ left: 776, top: 235 }}>
                <p className="text-xs font-bold uppercase text-amber-700">Latest version</p>
                <p className="mt-1 font-bold">reviewed_copy.step</p>
                <p className="mt-1 text-xs text-slate-500">Review before merge</p>
              </div>
            </div>
          </div>

          <div className="mt-5 rounded-xl border border-blue-200 bg-blue-50 p-5">
            <p className="text-xs font-bold uppercase tracking-wider text-blue-600">
              Step {currentStep + 1}
            </p>
            <h4 className="mt-1 text-xl font-bold">{step.title}</h4>
            <p className="mt-2 leading-6 text-slate-600">{step.text}</p>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 px-6 py-4 sm:px-8">
          <button
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={currentStep === 0}
            onClick={() => setCurrentStep((value) => Math.max(0, value - 1))}
            type="button"
          >
            ← Back
          </button>
          {currentStep < steps.length - 1 ? (
            <button
              className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              onClick={() => setCurrentStep((value) => Math.min(steps.length - 1, value + 1))}
              type="button"
            >
              Next →
            </button>
          ) : (
            <button
              className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
              onClick={onClose}
              type="button"
            >
              Finish walkthrough
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

type ProjectWorkspaceProps = {
  project: ProjectSummary;
  branches: BranchRecord[];
  packages: CadPackage[];
  primaryPackage: CadPackage | null;
  primaryHistory: CadPackage[];
  currentUserId: string;
  isAdmin: boolean;
  ownedActiveBranches: BranchRecord[];
  selectedBranchId: string;
  branchName: string;
  branchSoftware: string;
  branchBasePackageId: string;
  versionDescription: string;
  showBranchForm: boolean;
  isLoading: boolean;
  isCreatingBranch: boolean;
  isUploading: boolean;
  mergingBranchId: DatabaseId | null;
  deletingBranchId: DatabaseId | null;
  renamingBranchId: DatabaseId | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  uploadPanelRef: React.RefObject<HTMLElement | null>;
  onBack: () => void;
  onShowBranchForm: () => void;
  onShowBranchFromPackage: (cadPackage: CadPackage) => void;
  onCancelBranch: () => void;
  onBranchNameChange: (value: string) => void;
  onBranchSoftwareChange: (value: string) => void;
  onBranchBasePackageIdChange: (value: string) => void;
  onCreateBranch: (event: FormEvent<HTMLFormElement>) => void;
  onSelectBranch: (value: string) => void;
  onSelectBranchForUpload: (branch: BranchRecord) => void;
  onFileSelection: (event: ChangeEvent<HTMLInputElement>) => void;
  onVersionDescriptionChange: (value: string) => void;
  onUploadVersion: () => void;
  onMergeBranch: (branch: BranchRecord) => void;
  onRenameBranch: (branch: BranchRecord) => void;
  onDeleteBranch: (branch: BranchRecord) => void;
};

function ProjectWorkspace({
  project,
  branches,
  packages,
  primaryPackage,
  primaryHistory,
  currentUserId,
  isAdmin,
  ownedActiveBranches,
  selectedBranchId,
  branchName,
  branchSoftware,
  branchBasePackageId,
  versionDescription,
  showBranchForm,
  isLoading,
  isCreatingBranch,
  isUploading,
  mergingBranchId,
  deletingBranchId,
  renamingBranchId,
  fileInputRef,
  uploadPanelRef,
  onBack,
  onShowBranchForm,
  onShowBranchFromPackage,
  onCancelBranch,
  onBranchNameChange,
  onBranchSoftwareChange,
  onBranchBasePackageIdChange,
  onCreateBranch,
  onSelectBranch,
  onSelectBranchForUpload,
  onFileSelection,
  onVersionDescriptionChange,
  onUploadVersion,
  onMergeBranch,
  onRenameBranch,
  onDeleteBranch,
}: ProjectWorkspaceProps) {
  const [showPrimaryOnly, setShowPrimaryOnly] = useState(false);
  const treeScrollerRef = useRef<HTMLDivElement>(null);

  function goToCurrentModel() {
    const scroller = treeScrollerRef.current;
    if (!scroller) return;
    const currentPrimary = scroller.querySelector<HTMLElement>(
      '[data-current-primary="true"]',
    );
    if (currentPrimary) {
      currentPrimary.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      return;
    }
    scroller.scrollTo({ left: scroller.scrollWidth, behavior: "smooth" });
  }

  const selectedBranchBase = packages.find(
    (cadPackage) => String(cadPackage.id) === branchBasePackageId,
  );

  return (
    <>
      <section className="mt-8 rounded-2xl border border-white/15 bg-[linear-gradient(135deg,_#0d3157_0%,_#061a33_100%)] px-6 py-7 text-white shadow-2xl sm:px-8">
        <button
          className="inline-flex items-center gap-2 rounded-lg border border-white/25 bg-white/10 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:border-white/50 hover:bg-white/20"
          onClick={onBack}
          type="button"
        >
          <span aria-hidden="true">←</span>
          Home
        </button>
        <div className="mt-5 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-blue-400">
              Project branch tree
            </p>
            <h2 className="mt-2 text-3xl font-bold sm:text-4xl">{project.name}</h2>
            <span className="mt-3 inline-flex rounded-full bg-blue-500/20 px-3 py-1 text-xs font-bold text-blue-100 ring-1 ring-blue-300/30">
              Project CAD · {project.cad_software || "Not specified"}
            </span>
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
          <div className="flex flex-wrap gap-2">
            <button
              className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              onClick={goToCurrentModel}
              type="button"
            >
              Go to current →
            </button>
            <button
              aria-pressed={showPrimaryOnly}
              className={`rounded-lg border px-4 py-2.5 text-sm font-semibold transition ${
                showPrimaryOnly
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              }`}
              onClick={() => setShowPrimaryOnly((current) => !current)}
              type="button"
            >
              {showPrimaryOnly ? "Show all branches" : "Primary only"}
            </button>
            <button
              className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
              onClick={onShowBranchForm}
              type="button"
            >
              + New Working Branch
            </button>
          </div>
        </div>

        {showBranchForm ? (
          <form
            className="border-b border-blue-100 bg-blue-50 px-6 py-5"
            onSubmit={onCreateBranch}
          >
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 lg:items-end">
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
              <label className="text-sm font-semibold text-slate-700">
                CAD software used on this branch
                <input
                  className="mt-2 w-full rounded-lg border border-blue-200 bg-white px-4 py-3 font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  placeholder="Creo, Fusion 360, SolidWorks…"
                  value={branchSoftware}
                  onChange={(event) => onBranchSoftwareChange(event.target.value)}
                  disabled={isCreatingBranch}
                  maxLength={80}
                  required
                />
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Branch from
                <select
                  className="mt-2 w-full rounded-lg border border-blue-200 bg-white px-4 py-3 font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  value={branchBasePackageId}
                  onChange={(event) => onBranchBasePackageIdChange(event.target.value)}
                  disabled={isCreatingBranch}
                >
                  <option value="">Project origin (no primary file)</option>
                  {primaryHistory.map((cadPackage, index) => (
                    <option
                      disabled={cadPackage.is_archived}
                      key={cadPackage.id}
                      value={String(cadPackage.id)}
                    >
                      Primary {index + 1}: {cadPackage.file_name}
                      {cadPackage.is_primary ? " (current)" : ""}
                      {cadPackage.is_archived ? " (archived offline)" : ""}
                    </option>
                  ))}
                  {branches.map((branch) => {
                    const branchVersions = packages
                      .filter(
                        (cadPackage) =>
                          String(cadPackage.branch_id) === String(branch.id) &&
                          !primaryHistory.some(
                            (primaryPackage) =>
                              String(primaryPackage.id) === String(cadPackage.id),
                          ),
                      )
                      .sort((first, second) => first.version_number - second.version_number);

                    return branchVersions.length > 0 ? (
                      <optgroup key={branch.id} label={branch.name}>
                        {branchVersions.map((cadPackage) => (
                          <option
                            disabled={cadPackage.is_archived}
                            key={cadPackage.id}
                            value={String(cadPackage.id)}
                          >
                            Version {cadPackage.version_number}: {cadPackage.file_name}
                            {cadPackage.is_archived ? " (archived offline)" : ""}
                          </option>
                        ))}
                      </optgroup>
                    ) : null;
                  })}
                </select>
              </label>
              <div className="flex gap-3 lg:col-span-3 lg:justify-end">
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
              Starts from {selectedBranchBase?.file_name ?? "the project origin"}. Choose
              any earlier primary version to create a branch from that point in the tree.
            </p>
          </form>
        ) : null}

        <div className="overflow-x-auto px-6 py-7" ref={treeScrollerRef}>
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
              isAdmin={isAdmin}
              primaryOnly={showPrimaryOnly}
              mergingBranchId={mergingBranchId}
              deletingBranchId={deletingBranchId}
              renamingBranchId={renamingBranchId}
              onSelectBranchForUpload={onSelectBranchForUpload}
              onShowBranchFromPackage={onShowBranchFromPackage}
              onMergeBranch={onMergeBranch}
              onRenameBranch={onRenameBranch}
              onDeleteBranch={onDeleteBranch}
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
const GRAPH_BRANCH_START_Y = 265;
const GRAPH_BRANCH_GAP = 185;
const GRAPH_BRANCH_NODE_OFFSET = 235;
const GRAPH_NODE_GAP = 270;
const GRAPH_MIN_ZOOM = 0.6;
const GRAPH_MAX_ZOOM = 1.4;
const GRAPH_ZOOM_STEP = 0.1;

type BranchGraphLayout = {
  branch: BranchRecord;
  allVersions: CadPackage[];
  versions: CadPackage[];
  isCollapsed: boolean;
  baseCenterX: number;
  baseCenterY: number;
  centerY: number;
  laneIndex: number;
  nodeLefts: number[];
  mergeTargetCenterX: number | null;
};

type VersionTreeGraphProps = {
  branches: BranchRecord[];
  packages: CadPackage[];
  primaryHistory: CadPackage[];
  currentUserId: string;
  isAdmin: boolean;
  primaryOnly: boolean;
  mergingBranchId: DatabaseId | null;
  deletingBranchId: DatabaseId | null;
  renamingBranchId: DatabaseId | null;
  onSelectBranchForUpload: (branch: BranchRecord) => void;
  onShowBranchFromPackage: (cadPackage: CadPackage) => void;
  onMergeBranch: (branch: BranchRecord) => void;
  onRenameBranch: (branch: BranchRecord) => void;
  onDeleteBranch: (branch: BranchRecord) => void;
};

function VersionTreeGraph({
  branches,
  packages,
  primaryHistory,
  currentUserId,
  isAdmin,
  primaryOnly,
  mergingBranchId,
  deletingBranchId,
  renamingBranchId,
  onSelectBranchForUpload,
  onShowBranchFromPackage,
  onMergeBranch,
  onRenameBranch,
  onDeleteBranch,
}: VersionTreeGraphProps) {
  const [collapsedBranchIds, setCollapsedBranchIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [zoom, setZoom] = useState(1);
  const graphBranches = primaryOnly ? [] : branches;
  const allBranchesCollapsed =
    graphBranches.length > 0 &&
    graphBranches.every((branch) => collapsedBranchIds.has(String(branch.id)));

  function toggleBranchCollapsed(branchId: DatabaseId) {
    const key = String(branchId);
    setCollapsedBranchIds((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAllBranches() {
    setCollapsedBranchIds(
      allBranchesCollapsed
        ? new Set()
        : new Set(graphBranches.map((branch) => String(branch.id))),
    );
  }

  function changeZoom(direction: -1 | 1) {
    setZoom((current) =>
      Math.min(
        GRAPH_MAX_ZOOM,
        Math.max(GRAPH_MIN_ZOOM, Number((current + direction * GRAPH_ZOOM_STEP).toFixed(1))),
      ),
    );
  }

  const rootCenterX = GRAPH_ROOT_LEFT + GRAPH_ROOT_WIDTH / 2;
  const primaryLeftById = new Map<string, number>();
  let previousPrimaryLeft = GRAPH_ROOT_LEFT;

  for (const [index, primaryVersion] of primaryHistory.entries()) {
    let primaryLeft = index === 0 ? 260 : previousPrimaryLeft + 330;
    const mergedBranch = graphBranches.find((branch) => {
      if (!branch.merged_at) return false;
      const versions = packages
        .filter((cadPackage) => String(cadPackage.branch_id) === String(branch.id))
        .sort((first, second) => first.version_number - second.version_number);
      return String(versions.at(-1)?.id) === String(primaryVersion.id);
    });

    if (mergedBranch) {
      const versions = collapsedBranchIds.has(String(mergedBranch.id))
        ? []
        : packages.filter(
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

  const packagePositions = new Map<string, { centerX: number; centerY: number }>(
    primaryHistory.map((cadPackage) => {
      const left = primaryLeftById.get(String(cadPackage.id))!;
      return [
        String(cadPackage.id),
        { centerX: left + GRAPH_NODE_WIDTH / 2, centerY: GRAPH_PRIMARY_CENTER_Y },
      ];
    }),
  );

  const branchLayouts: BranchGraphLayout[] = [...graphBranches]
    .sort(
      (first, second) =>
        new Date(first.created_at).getTime() - new Date(second.created_at).getTime(),
    )
    .map((branch) => {
    const allVersions = packages
      .filter((cadPackage) => String(cadPackage.branch_id) === String(branch.id))
      .sort((first, second) => first.version_number - second.version_number);
    const isCollapsed = collapsedBranchIds.has(String(branch.id));
    const versions = isCollapsed ? [] : allVersions;
    const exactBasePosition = branch.base_package_id
      ? packagePositions.get(String(branch.base_package_id))
      : undefined;
    const filenameBase = [...primaryHistory]
      .reverse()
      .find((cadPackage) => cadPackage.file_name === branch.branched_from_file_name);
    const filenameBaseLeft = filenameBase
      ? primaryLeftById.get(String(filenameBase.id))
      : undefined;
    const baseCenterX =
      exactBasePosition?.centerX ??
      (filenameBaseLeft === undefined
        ? rootCenterX
        : filenameBaseLeft + GRAPH_NODE_WIDTH / 2);
    const baseCenterY = exactBasePosition?.centerY ?? GRAPH_PRIMARY_CENTER_Y;
    const allNodeLefts = allVersions.map(
      (_, versionIndex) =>
        baseCenterX + GRAPH_BRANCH_NODE_OFFSET + versionIndex * GRAPH_NODE_GAP,
    );
    const nodeLefts = isCollapsed ? [] : allNodeLefts;
    const latestVersion = allVersions.at(-1);
    const mergeTargetLeft =
      branch.merged_at && latestVersion
        ? primaryLeftById.get(String(latestVersion.id))
        : undefined;

    const layout = {
      branch,
      allVersions,
      versions,
      isCollapsed,
      baseCenterX,
      baseCenterY,
      centerY: GRAPH_BRANCH_START_Y,
      laneIndex: 0,
      nodeLefts,
      mergeTargetCenterX:
        mergeTargetLeft === undefined ? null : mergeTargetLeft + GRAPH_NODE_WIDTH / 2,
    };

    for (const [index, cadPackage] of allVersions.entries()) {
      packagePositions.set(String(cadPackage.id), {
        centerX: allNodeLefts[index] + GRAPH_NODE_WIDTH / 2,
        centerY: layout.centerY,
      });
    }

    return layout;
  });

  const laneRightEdges: number[] = [];
  for (const layout of [...branchLayouts].sort(
    (first, second) => first.baseCenterX - second.baseCenterX,
  )) {
    const resolvedBasePosition = layout.branch.base_package_id
      ? packagePositions.get(String(layout.branch.base_package_id))
      : undefined;
    if (resolvedBasePosition) {
      layout.baseCenterX = resolvedBasePosition.centerX;
      layout.baseCenterY = resolvedBasePosition.centerY;
    }
    const branchLeft = layout.baseCenterX;
    const lastNodeRight =
      (layout.nodeLefts.at(-1) ?? layout.baseCenterX + GRAPH_BRANCH_NODE_OFFSET) +
      GRAPH_NODE_WIDTH;
    const branchRight = Math.max(
      lastNodeRight,
      layout.mergeTargetCenterX ?? branchLeft,
    );
    const availableLane = laneRightEdges.findIndex(
      (rightEdge) => rightEdge + 50 < branchLeft,
    );
    const laneIndex = availableLane === -1 ? laneRightEdges.length : availableLane;

    layout.laneIndex = laneIndex;
    layout.centerY = GRAPH_BRANCH_START_Y + laneIndex * GRAPH_BRANCH_GAP;
    laneRightEdges[laneIndex] = branchRight;

    for (const [index, cadPackage] of layout.allVersions.entries()) {
      packagePositions.set(String(cadPackage.id), {
        centerX:
          layout.baseCenterX +
          GRAPH_BRANCH_NODE_OFFSET +
          index * GRAPH_NODE_GAP +
          GRAPH_NODE_WIDTH / 2,
        centerY: layout.centerY,
      });
    }
  }

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
    graphBranches.length > 0
      ? GRAPH_BRANCH_START_Y +
        Math.max(0, ...branchLayouts.map((layout) => layout.laneIndex)) *
          GRAPH_BRANCH_GAP +
        150
      : 330;
  const firstPrimaryLeft = primaryHistory[0]
    ? primaryLeftById.get(String(primaryHistory[0].id))
    : undefined;
  const firstPrimaryCenterX =
    firstPrimaryLeft === undefined
      ? rootCenterX + 300
      : firstPrimaryLeft + GRAPH_NODE_WIDTH / 2;

  return (
    <div>
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
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div
            aria-label="Tree zoom controls"
            className="flex items-center rounded-lg border border-slate-300 bg-white shadow-sm"
            role="group"
          >
            <button
              aria-label="Zoom out"
              className="h-8 w-9 rounded-l-lg text-base font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
              disabled={zoom <= GRAPH_MIN_ZOOM}
              onClick={() => changeZoom(-1)}
              type="button"
            >
              −
            </button>
            <button
              aria-label="Reset tree zoom"
              className="h-8 min-w-14 border-x border-slate-200 px-2 text-[11px] font-bold text-slate-600 hover:bg-slate-50"
              onClick={() => setZoom(1)}
              title="Reset zoom"
              type="button"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              aria-label="Zoom in"
              className="h-8 w-9 rounded-r-lg text-base font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
              disabled={zoom >= GRAPH_MAX_ZOOM}
              onClick={() => changeZoom(1)}
              type="button"
            >
              +
            </button>
          </div>
          {!primaryOnly && graphBranches.length > 0 ? (
            <button
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
              onClick={toggleAllBranches}
              type="button"
            >
              {allBranchesCollapsed ? "Expand all branches" : "Collapse all branches"}
            </button>
          ) : null}
        </div>
      </div>

      <div
        style={{ width: canvasWidth * zoom, height: canvasHeight * zoom }}
      >
        <div
          className="relative origin-top-left rounded-xl bg-slate-50/80 ring-1 ring-slate-100"
          style={{
            width: canvasWidth,
            height: canvasHeight,
            transform: `scale(${zoom})`,
          }}
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
                  d={`M ${layout.baseCenterX} ${layout.baseCenterY + GRAPH_NODE_HEIGHT / 2} V ${layout.centerY} H ${firstNodeCenterX}`}
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
                  cy={layout.baseCenterY + GRAPH_NODE_HEIGHT / 2}
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
          const canManageBranch = ownsBranch || isAdmin;
          const canMerge =
            ownsBranch && !layout.branch.merged_at && layout.allVersions.length > 0;
          const latestBranchVersion = layout.allVersions.at(-1);
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
                <div className="mt-1 flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-bold" title={layout.branch.name}>
                    {layout.branch.name}
                  </p>
                  {canManageBranch ? (
                    <details className="relative shrink-0">
                      <summary
                        aria-label={`More options for ${layout.branch.name}`}
                        className="flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-full text-base font-bold tracking-widest text-slate-500 hover:bg-slate-100 hover:text-slate-900 [&::-webkit-details-marker]:hidden"
                      >
                        ⋯
                      </summary>
                      <div className="absolute right-0 z-20 mt-1 w-40 rounded-lg border border-slate-200 bg-white p-1 shadow-xl">
                        <button
                          className="w-full rounded-md px-2.5 py-2 text-left text-[11px] font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                          onClick={() => onRenameBranch(layout.branch)}
                          type="button"
                          disabled={renamingBranchId !== null || deletingBranchId !== null}
                        >
                          {String(renamingBranchId) === String(layout.branch.id)
                            ? "Renaming…"
                            : "Rename branch"}
                        </button>
                        <button
                          className="w-full rounded-md px-2.5 py-2 text-left text-[11px] font-bold text-red-600 hover:bg-red-50 disabled:opacity-60"
                          onClick={() => onDeleteBranch(layout.branch)}
                          type="button"
                          disabled={deletingBranchId !== null}
                        >
                          {String(deletingBranchId) === String(layout.branch.id)
                            ? "Deleting…"
                            : "Delete branch"}
                        </button>
                      </div>
                    </details>
                  ) : null}
                </div>
                <p className="mt-1 truncate text-[11px] text-slate-500">
                  {layout.branch.owner_name}
                </p>
                <p className="mt-1 truncate text-[10px] font-bold text-blue-600">
                  {layout.branch.cad_software || "CAD software not specified"}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {layout.allVersions.length > 0 ? (
                    <button
                      className="rounded border border-slate-300 px-2 py-1 text-[10px] font-bold hover:bg-slate-50"
                      onClick={() => toggleBranchCollapsed(layout.branch.id)}
                      type="button"
                    >
                      {layout.isCollapsed ? "Expand" : "Collapse"}
                    </button>
                  ) : null}
                  {latestBranchVersion && !latestBranchVersion.is_archived ? (
                    <button
                      className="rounded border border-blue-300 bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700 hover:bg-blue-100"
                      onClick={() => onShowBranchFromPackage(latestBranchVersion)}
                      title={`Start a new branch from ${latestBranchVersion.file_name}`}
                      type="button"
                    >
                      Branch here
                    </button>
                  ) : null}
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
                  {layout.isCollapsed
                    ? `${pluralize(layout.allVersions.length, "version")} collapsed`
                    : "No versions uploaded yet"}
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
      data-current-primary={cadPackage.is_primary ? "true" : undefined}
      style={{ left, top }}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-bold uppercase tracking-wider">{label}</p>
        {cadPackage.is_primary ? (
          <span className="rounded-full bg-blue-100 px-2 py-1 text-[9px] font-bold uppercase text-blue-700">
            Current
          </span>
        ) : cadPackage.is_archived ? (
          <span className="rounded-full bg-slate-200 px-2 py-1 text-[9px] font-bold uppercase text-slate-600">
            Archived
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
        {cadPackage.is_archived ? (
          <span
            className="font-bold text-slate-400"
            title={cadPackage.archive_name ?? "Exported archive"}
          >
            Offline
          </span>
        ) : (
          <a
            className="font-bold text-blue-600 hover:text-blue-700"
            href={cadPackage.downloadUrl}
            download={cadPackage.file_name}
          >
            Download
          </a>
        )}
      </div>
    </article>
  );
}
