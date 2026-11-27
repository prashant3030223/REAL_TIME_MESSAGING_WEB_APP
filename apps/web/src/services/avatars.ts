export type MemojiAvatar = {
  id: string;
  label: string;
  url: string;
};

export const MEMOJI_AVATARS: MemojiAvatar[] = [
  { id: "boy", label: "Boy", url: "/avatars/boy.png" },
  { id: "mouse", label: "Mouse", url: "/avatars/mouse.png" },
  { id: "octopus", label: "Octopus", url: "/avatars/octopus.png" },
  { id: "cow", label: "Cow", url: "/avatars/cow.png" },
  { id: "giraffe", label: "Giraffe", url: "/avatars/giraffe.png" },
  { id: "shark", label: "Shark", url: "/avatars/shark.png" },
  { id: "owl", label: "Owl", url: "/avatars/owl.png" },
  { id: "boar", label: "Boar", url: "/avatars/boar.png" },
  { id: "monkey", label: "Monkey", url: "/avatars/monkey.png" },
  { id: "robot", label: "Robot", url: "/avatars/robot.png" },
  { id: "cat", label: "Cat", url: "/avatars/cat.png" },
  { id: "dog", label: "Dog", url: "/avatars/dog.png" },
  { id: "alien", label: "Alien", url: "/avatars/alien.png" },
  { id: "fox", label: "Fox", url: "/avatars/fox.png" },
  { id: "poop", label: "Poop", url: "/avatars/poop.png" },
  { id: "pig", label: "Pig", url: "/avatars/pig.png" },
  { id: "panda", label: "Panda", url: "/avatars/panda.png" },
  { id: "rabbit", label: "Rabbit", url: "/avatars/rabbit.png" },
  { id: "chicken", label: "Chicken", url: "/avatars/chicken.png" },
  { id: "unicorn", label: "Unicorn", url: "/avatars/unicorn.png" },
  { id: "lion", label: "Lion", url: "/avatars/lion.png" },
  { id: "dragon", label: "Dragon", url: "/avatars/dragon.png" },
  { id: "skull", label: "Skull", url: "/avatars/skull.png" },
  { id: "bear", label: "Bear", url: "/avatars/bear.png" },
  { id: "tiger", label: "Tiger", url: "/avatars/tiger.png" },
  { id: "koala", label: "Koala", url: "/avatars/koala.png" },
  { id: "dino", label: "Dino", url: "/avatars/dino.png" },
  { id: "ghost", label: "Ghost", url: "/avatars/ghost.png" },
];

export let DEFAULT_AVATAR = "/avatars/boy.png";

function createAvatarDataUrl(id: string, label: string): string {
  const palettes: Record<string, [string, string]> = {
    boy: ["#38bdf8", "#1e3a8a"],
    mouse: ["#c4b5fd", "#5b21b6"],
    octopus: ["#f0abfc", "#86198f"],
    cow: ["#f8fafc", "#334155"],
    giraffe: ["#fde68a", "#92400e"],
    shark: ["#7dd3fc", "#0369a1"],
    owl: ["#fdba74", "#9a3412"],
    boar: ["#fda4af", "#9f1239"],
    monkey: ["#d6b08a", "#78350f"],
    robot: ["#a5b4fc", "#3730a3"],
    cat: ["#fde68a", "#b45309"],
    dog: ["#fdba74", "#78350f"],
    alien: ["#86efac", "#166534"],
    fox: ["#fb923c", "#9a3412"],
    poop: ["#a8a29e", "#44403c"],
    pig: ["#fda4af", "#be185d"],
    panda: ["#e2e8f0", "#1e293b"],
    rabbit: ["#ddd6fe", "#6d28d9"],
    chicken: ["#fef08a", "#ca8a04"],
    unicorn: ["#f0abfc", "#7e22ce"],
    lion: ["#fcd34d", "#b45309"],
    dragon: ["#86efac", "#166534"],
    skull: ["#e5e7eb", "#334155"],
    bear: ["#d6b08a", "#78350f"],
    tiger: ["#fdba74", "#c2410c"],
    koala: ["#cbd5e1", "#475569"],
    dino: ["#86efac", "#15803d"],
    ghost: ["#ddd6fe", "#475569"],
  };
  const [background, accent] = palettes[id] ?? ["#5eead4", "#0f766e"];
  const initial = label.slice(0, 1).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${background}"/><stop offset="1" stop-color="${accent}"/></linearGradient></defs>
    <rect width="160" height="160" rx="36" fill="url(#g)"/>
    <circle cx="80" cy="68" r="42" fill="rgba(255,255,255,.92)"/>
    <circle cx="64" cy="63" r="5" fill="#172033"/><circle cx="96" cy="63" r="5" fill="#172033"/>
    <path d="M58 86c12 12 32 12 44 0" fill="none" stroke="#172033" stroke-width="7" stroke-linecap="round"/>
    <circle cx="80" cy="68" r="49" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="3"/>
    <text x="80" y="145" text-anchor="middle" fill="white" font-family="Arial,sans-serif" font-size="16" font-weight="700">${initial}</text>
  </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

for (const avatar of MEMOJI_AVATARS) {
  avatar.url = createAvatarDataUrl(avatar.id, avatar.label);
}
DEFAULT_AVATAR = MEMOJI_AVATARS[0]!.url;
export const AVATAR_PRESETS = MEMOJI_AVATARS.map((avatar) => avatar.url);

export function getSafeAvatar(avatarUrl?: string | null, nameSeed?: string): string {
  if (avatarUrl?.startsWith("/avatars/")) {
    const id = avatarUrl.split("/").pop()?.replace(".png", "").replace(".svg", "");
    return MEMOJI_AVATARS.find((avatar) => avatar.id === id)?.url ?? MEMOJI_AVATARS[0]!.url;
  }
  if (!avatarUrl || avatarUrl.includes("unsplash.com")) {
    if (nameSeed) {
      let hash = 0;
      for (let i = 0; i < nameSeed.length; i++) {
        hash = (hash << 5) - hash + nameSeed.charCodeAt(i);
        hash |= 0;
      }
      const index = Math.abs(hash) % MEMOJI_AVATARS.length;
      return MEMOJI_AVATARS[index]!.url;
    }
    return MEMOJI_AVATARS[0]!.url;
  }
  return avatarUrl;
}
