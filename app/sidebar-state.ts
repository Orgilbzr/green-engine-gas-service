// A small browser-only store; SSR always renders the expanded sidebar.
const key = "sidebarCollapsed";
let fallback = false;
let storageUnavailable = false;
const listeners = new Set<() => void>();

export function getSidebarCollapsed(): boolean {
  if (storageUnavailable) return fallback;
  try {
    return window.localStorage.getItem(key) === "true";
  } catch {
    storageUnavailable = true;
    return fallback;
  }
}

export function getServerSidebarCollapsed(): boolean {
  return false;
}

export function toggleSidebarCollapsed(): void {
  fallback = !getSidebarCollapsed();
  try {
    window.localStorage.setItem(key, String(fallback));
  } catch {
    storageUnavailable = true;
    // Keep the control usable for this session when storage is blocked.
  }
  listeners.forEach(listener => listener());
}

export function subscribeSidebarCollapsed(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === key || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}
