import { useEffect, useState } from "react";
import { Theme } from "@radix-ui/themes";
import { AppShell } from "./components/AppShell";
import { WorkspaceProvider } from "./lib/store";
import type { Page } from "./lib/model";

function getPage(): Page {
  // The final segment also resolves links from the original Studio preview.
  const page = window.location.hash.replace(/^#\/?/, "").split("/").at(-1);
  return ["today", "unbilled", "history", "settings"].includes(page || "")
    ? (page as Page)
    : "today";
}

function Workspace() {
  const [page, setPage] = useState(getPage);
  useEffect(() => {
    const navigate = () => {
      setPage(getPage());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, []);
  useEffect(() => {
    document.title = `timenow · ${page.charAt(0).toUpperCase() + page.slice(1)}`;
    if (window.location.hash !== `#/${page}`) {
      window.history.replaceState(null, "", `#/${page}`);
    }
  }, [page]);

  return (
    <>
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        Skip to content
      </a>
      <AppShell page={page} />
    </>
  );
}

export default function App() {
  return (
    <WorkspaceProvider>
      <Theme
        appearance="light"
        accentColor="iris"
        grayColor="slate"
        radius="medium"
        scaling="100%"
      >
        <Workspace />
      </Theme>
    </WorkspaceProvider>
  );
}
