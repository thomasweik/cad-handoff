"use client";

import { ChangeEvent, useState } from "react";

type CadPackage = {
  id: number;
  fileName: string;
  owner: string;
  description: string;
  uploadedAt: string;
  downloadUrl: string;
};

export default function Home() {
  const [name, setName] = useState("");
  const [currentUser, setCurrentUser] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [description, setDescription] = useState("");
  const [workingCopies, setWorkingCopies] = useState<CadPackage[]>([]);
  const [primaryPackage, setPrimaryPackage] = useState<CadPackage | null>(
    null,
  );

  function handleFileSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
  }

  function uploadWorkingCopy() {
    if (!selectedFile) {
      alert("Please select a CAD package first.");
      return;
    }

    const newPackage: CadPackage = {
      id: Date.now(),
      fileName: selectedFile.name,
      owner: currentUser,
      description: description.trim() || "No description provided",
      uploadedAt: new Date().toLocaleString(),
      downloadUrl: URL.createObjectURL(selectedFile),
    };

    setWorkingCopies((currentCopies) => [
      newPackage,
      ...currentCopies,
    ]);

    setSelectedFile(null);
    setDescription("");
  }

  function makePrimary(cadPackage: CadPackage) {
    setPrimaryPackage(cadPackage);
  }

  if (!currentUser) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl">
          <h1 className="text-3xl font-bold text-slate-900">
            CAD Handoff
          </h1>

          <p className="mt-2 text-slate-600">
            Enter your name to access the team workspace.
          </p>

          <input
            className="mt-6 w-full rounded-lg border border-slate-300 px-4 py-3 text-slate-900"
            placeholder="Your name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />

          <button
            className="mt-4 w-full rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700"
            onClick={() => {
              if (name.trim()) {
                setCurrentUser(name.trim());
              }
            }}
          >
            Enter Workspace
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 p-8 text-slate-900">
      <div className="mx-auto max-w-6xl">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">CAD Handoff</h1>
            <p className="text-slate-600">
              Senior Design CAD Workspace
            </p>
          </div>

          <div className="rounded-full bg-white px-4 py-2 shadow-sm">
            Signed in as <strong>{currentUser}</strong>
          </div>
        </header>

        <section className="mt-8 rounded-2xl bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase text-blue-600">
            Current Primary Package
          </p>

          {primaryPackage ? (
            <div className="mt-3">
              <h2 className="text-2xl font-bold">
                {primaryPackage.fileName}
              </h2>

              <p className="mt-2 text-slate-600">
                Uploaded by {primaryPackage.owner}
              </p>

              <p className="mt-1 text-slate-600">
                {primaryPackage.description}
              </p>

              <a
                className="mt-5 inline-block rounded-lg bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-700"
                href={primaryPackage.downloadUrl}
                download={primaryPackage.fileName}
              >
                Download Primary
              </a>
            </div>
          ) : (
            <div className="mt-3">
              <h2 className="text-2xl font-bold">
                No primary package selected
              </h2>

              <p className="mt-2 text-slate-600">
                Upload a working copy and promote it to primary.
              </p>
            </div>
          )}
        </section>

        <section className="mt-8 rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="text-2xl font-bold">
            Upload Working Copy
          </h2>

          <input
            className="mt-5 block w-full rounded-lg border border-slate-300 p-3"
            type="file"
            accept=".zip,.prt,.asm,.step,.stp"
            onChange={handleFileSelection}
          />

          <textarea
            className="mt-4 w-full rounded-lg border border-slate-300 p-3"
            placeholder="Describe what you changed"
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />

          <button
            className="mt-4 rounded-lg bg-slate-900 px-5 py-3 font-semibold text-white hover:bg-slate-700"
            onClick={uploadWorkingCopy}
          >
            Upload Working Copy
          </button>
        </section>

        <section className="mt-8">
          <h2 className="text-2xl font-bold">Working Copies</h2>

          {workingCopies.length === 0 ? (
            <div className="mt-4 rounded-2xl border-2 border-dashed border-slate-300 bg-white p-10 text-center">
              <p className="font-semibold">No working copies yet</p>
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              {workingCopies.map((cadPackage) => (
                <article
                  className="rounded-2xl bg-white p-6 shadow-sm"
                  key={cadPackage.id}
                >
                  <h3 className="text-xl font-bold">
                    {cadPackage.fileName}
                  </h3>

                  <p className="mt-2 text-slate-600">
                    Uploaded by {cadPackage.owner} on{" "}
                    {cadPackage.uploadedAt}
                  </p>

                  <p className="mt-2">{cadPackage.description}</p>

                  <div className="mt-5 flex gap-3">
                    <a
                      className="rounded-lg border border-slate-300 px-4 py-2 font-semibold hover:bg-slate-100"
                      href={cadPackage.downloadUrl}
                      download={cadPackage.fileName}
                    >
                      Download
                    </a>

                    <button
                      className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700"
                      onClick={() => makePrimary(cadPackage)}
                    >
                      Make Primary
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}