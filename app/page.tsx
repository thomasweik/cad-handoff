"use client";

import { useState } from "react";

export default function Home() {
  const [name, setName] = useState("");
  const [currentUser, setCurrentUser] = useState("");

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

          <h2 className="mt-2 text-2xl font-bold">
            No primary package uploaded
          </h2>

          <p className="mt-2 text-slate-600">
            Upload the first native Creo CAD package to begin.
          </p>

          <button className="mt-5 rounded-lg bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-700">
            Upload Primary Package
          </button>
        </section>

        <section className="mt-8">
          <h2 className="text-2xl font-bold">Working Copies</h2>

          <div className="mt-4 rounded-2xl border-2 border-dashed border-slate-300 bg-white p-10 text-center">
            <p className="font-semibold">No working copies yet</p>
            <p className="mt-1 text-slate-500">
              Copies uploaded by team members will appear here.
            </p>

            <button className="mt-5 rounded-lg bg-slate-900 px-5 py-3 font-semibold text-white hover:bg-slate-700">
              Upload Working Copy
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}