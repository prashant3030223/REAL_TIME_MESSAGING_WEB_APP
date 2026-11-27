export const CHAT_WALLPAPERS = [
  { id: "original", label: "Original", image: null },
  { id: "connect-sphere", label: "ConnectSphere", image: "/wallpapers/chat_wallpaper.svg" },
  { id: "aurora", label: "Aurora", image: "/wallpapers/wallpaper_aurora.png" },
  { id: "cubes", label: "Cubes", image: "/wallpapers/wallpaper_cubes.png" },
  { id: "flow", label: "Flow", image: "/wallpapers/wallpaper_flow.png" },
  { id: "graph", label: "Network", image: "/wallpapers/wallpaper_graph.png" },
  { id: "waves", label: "Waves", image: "/wallpapers/wallpaper_waves.png" },
] as const;

export type ChatWallpaperId = (typeof CHAT_WALLPAPERS)[number]["id"];

export const CUSTOM_CHAT_WALLPAPER_ID = "custom" as const;
export type ChatWallpaperSelection = ChatWallpaperId | typeof CUSTOM_CHAT_WALLPAPER_ID;

export const DEFAULT_CHAT_WALLPAPER: ChatWallpaperSelection = "graph";
