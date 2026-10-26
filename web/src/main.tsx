import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <main className="p-4 text-slate-900">
      <h1 className="text-xl font-semibold">Finance Tracker</h1>
    </main>
  </StrictMode>,
);
