export type WorkspaceViewer = {
  displayName: string;
  workspaceName: string;
  role: "admin" | "member";
};

/**
 * Display-only data for the initial authenticated-route shell.
 * Replace this with an owned session and membership lookup once an auth
 * provider and workspace database have been selected.
 */
export const shellPreviewViewer: WorkspaceViewer = {
  displayName: "Workspace user",
  workspaceName: "Harborline",
  role: "admin",
};
