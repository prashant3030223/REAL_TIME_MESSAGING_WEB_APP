import { useState, useRef, useEffect } from "react";
import {
  Edit3,
  FileText,
  Download,
  Trash2,
  CheckSquare,
  Square,
  Plus,
  Minus,
  Maximize2,
  Sparkles,
  Users,
  StickyNote,
  Layers,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Check,
  X,
  PenTool,
  Highlighter,
  Eraser,
  GripVertical,
} from "lucide-react";
import type { CollaborativeDoc } from "../services/types.js";
import { realtime } from "../services/realtime.js";
import { getSafeAvatar } from "../services/avatars.js";

type WorkspaceViewProps = {
  doc: CollaborativeDoc;
  onUpdateDoc: (doc: CollaborativeDoc) => void;
};

type SprintCard = {
  id: string;
  title: string;
  tag: string;
  color: string;
  tasks: Array<{ text: string; done: boolean }>;
  x: number;
  y: number;
};

type SprintCardDrag = {
  cardId: string;
  startClientX: number;
  startClientY: number;
  cardX: number;
  cardY: number;
  cardWidth: number;
  cardHeight: number;
  mobileBaseX: number;
  mobileBaseY: number;
  mobileOffsetX: number;
  mobileOffsetY: number;
  isMobile: boolean;
};

const CARD_COLOR_OPTIONS = [
  { name: "Green", value: "#00a884" },
  { name: "Purple", value: "#6366f1" },
  { name: "Pink", value: "#f43f5e" },
  { name: "Yellow", value: "#fbbf24" },
  { name: "Cyan", value: "#06b6d4" },
  { name: "White", value: "#ffffff" },
  { name: "Orange", value: "#f59e0b" },
];

export function WorkspaceView({ doc, onUpdateDoc }: WorkspaceViewProps) {
  const [activeTab, setActiveTab] = useState<"whiteboard" | "notes">("whiteboard");
  const [onlineCollaborators, setOnlineCollaborators] = useState<
    Array<{ userId: string; displayName?: string; avatar?: string }>
  >([]);

  // Whiteboard State
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const toolbarDragRef = useRef<{
    offsetX: number;
    offsetY: number;
    startX: number;
    startY: number;
  } | null>(null);
  const cardDragRef = useRef<SprintCardDrag | null>(null);
  const toolbarDidDragRef = useRef(false);
  const lastDrawPointRef = useRef<{ x: number; y: number } | null>(null);
  const noteSyncTimerRef = useRef<number | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [tool, setTool] = useState<"pen" | "highlighter" | "eraser">("pen");
  const [drawColor, setDrawColor] = useState("#00a884");
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [toolbarPosition, setToolbarPosition] = useState<{ left: number; top: number } | null>(null);
  const [isMobileLayout, setIsMobileLayout] = useState(() => window.innerWidth <= 768);

  // Sprint / Sticky Cards State (matching Reference Image 3)
  const [cards, setCards] = useState<SprintCard[]>([]);
  const [mobileCardOffsets, setMobileCardOffsets] = useState<Record<string, { x: number; y: number }>>({});
  const [showCards, setShowCards] = useState(true);
  const [showAddCardModal, setShowAddCardModal] = useState(false);
  const [newCardTitle, setNewCardTitle] = useState("");
  const [newCardTasks, setNewCardTasks] = useState("");
  const [newCardColor, setNewCardColor] = useState("#f59e0b");

  // Notes state
  const [noteContent, setNoteContent] = useState(doc.content);
  const [tasks, setTasks] = useState(doc.tasks);
  const [newTaskText, setNewTaskText] = useState("");

  useEffect(() => () => {
    if (noteSyncTimerRef.current !== null) window.clearTimeout(noteSyncTimerRef.current);
  }, []);

  useEffect(() => {
    const keepToolbarInBounds = () => {
      setIsMobileLayout(window.innerWidth <= 768);
      const workspace = containerRef.current;
      const toolbar = toolbarRef.current;
      if (!workspace || !toolbar) return;

      const workspaceBounds = workspace.getBoundingClientRect();
      const toolbarBounds = toolbar.getBoundingClientRect();
      setToolbarPosition((position) => {
        if (!position) return null;
        return {
          left: Math.min(Math.max(8, workspaceBounds.width - toolbarBounds.width - 8), Math.max(8, position.left)),
          top: Math.min(Math.max(8, workspaceBounds.height - toolbarBounds.height - 8), Math.max(8, position.top)),
        };
      });
    };
    window.addEventListener("resize", keepToolbarInBounds);
    return () => window.removeEventListener("resize", keepToolbarInBounds);
  }, []);

  useEffect(() => realtime.subscribe(
    "presence:update",
    (data: { onlineUsers?: Array<{ userId: string; displayName?: string; avatar?: string }> }) => {
      if (Array.isArray(data?.onlineUsers)) setOnlineCollaborators(data.onlineUsers);
    }
  ), []);

  // Resize canvas to match full-bleed container
  useEffect(() => {
    if (activeTab !== "whiteboard") return;
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const targetW = Math.round(rect.width * dpr);
        const targetH = Math.round(rect.height * dpr);

        if (canvas.width !== targetW || canvas.height !== targetH) {
          const tempCanvas = document.createElement("canvas");
          tempCanvas.width = canvas.width;
          tempCanvas.height = canvas.height;
          const tempCtx = tempCanvas.getContext("2d");
          if (tempCtx && canvas.width > 0 && canvas.height > 0) {
            tempCtx.drawImage(canvas, 0, 0);
          }

          canvas.width = targetW;
          canvas.height = targetH;

          const ctx = canvas.getContext("2d");
          if (ctx && tempCanvas.width > 0 && tempCanvas.height > 0) {
            ctx.drawImage(tempCanvas, 0, 0, canvas.width, canvas.height);
          }
        }
      }
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
  }, [activeTab]);

  // Realtime Live Collaboration Synchronizer
  useEffect(() => {
    const unsubStroke = realtime.subscribe("whiteboard:stroke", (stroke) => {
      const canvas = canvasRef.current;
      if (!canvas || !stroke?.points || stroke.points.length === 0) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const points = stroke.normalized
        ? stroke.points.map((point: { x: number; y: number }) => ({
            x: point.x * canvas.width,
            y: point.y * canvas.height,
          }))
        : stroke.points;

      ctx.save();
      ctx.beginPath();
      if (stroke.tool === "eraser") {
        ctx.globalCompositeOperation = "destination-out";
        ctx.lineWidth = (stroke.width || 3) * 6 * dpr;
      } else if (stroke.tool === "highlighter") {
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = (stroke.color || "#00a884") + "55";
        ctx.lineWidth = (stroke.width || 3) * 3 * dpr;
      } else {
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = stroke.color || "#00a884";
        ctx.lineWidth = (stroke.width || 3) * dpr;
      }
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.stroke();
      ctx.restore();
    });

    const unsubClear = realtime.subscribe("whiteboard:clear", () => {
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
      }
    });

    const unsubNotes = realtime.subscribe("collab:notes", (data) => {
      if (data?.content !== undefined) {
        setNoteContent(data.content);
        onUpdateDoc({ ...doc, content: data.content });
      }
    });

    const unsubTask = realtime.subscribe("collab:task", ({ taskId, completed, text }) => {
      setTasks((prev) => {
        const exists = prev.some((task) => task.id === taskId);
        const updated = exists
          ? prev.map((task) =>
              task.id === taskId ? { ...task, done: Boolean(completed) } : task
            )
          : typeof text === "string"
            ? [...prev, { id: taskId, text, done: Boolean(completed) }]
            : prev;
        onUpdateDoc({ ...doc, tasks: updated });
        return updated;
      });
    });

    return () => {
      unsubStroke();
      unsubClear();
      unsubNotes();
      unsubTask();
    };
  }, [doc]);

  function getCanvasCoords(clientX: number, clientY: number) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: ((clientX - rect.left) / rect.width) * canvas.width,
      y: ((clientY - rect.top) / rect.height) * canvas.height,
      normX: (clientX - rect.left) / rect.width,
      normY: (clientY - rect.top) / rect.height,
    };
  }

  function startDrawing(clientX: number, clientY: number) {
    const coords = getCanvasCoords(clientX, clientY);
    if (!coords) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(coords.x, coords.y);

    if (tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineWidth = strokeWidth * 6 * dpr;
    } else if (tool === "highlighter") {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = drawColor + "55";
      ctx.lineWidth = strokeWidth * 3 * dpr;
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = drawColor;
      ctx.lineWidth = strokeWidth * dpr;
    }

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    setIsDrawing(true);
    lastDrawPointRef.current = { x: coords.normX, y: coords.normY };
  }

  function drawTo(clientX: number, clientY: number) {
    if (!isDrawing) return;
    const coords = getCanvasCoords(clientX, clientY);
    if (!coords) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    if (tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineWidth = strokeWidth * 6 * dpr;
    } else if (tool === "highlighter") {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = drawColor + "55";
      ctx.lineWidth = strokeWidth * 3 * dpr;
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = drawColor;
      ctx.lineWidth = strokeWidth * dpr;
    }

    ctx.lineTo(coords.x, coords.y);
    ctx.stroke();

    const normalizedPoint = { x: coords.normX, y: coords.normY };
    if (lastDrawPointRef.current) {
      realtime.sendWhiteboardStroke({
        points: [lastDrawPointRef.current, normalizedPoint],
        color: drawColor,
        width: strokeWidth,
        tool,
        normalized: true,
      });
    }
    lastDrawPointRef.current = normalizedPoint;
  }

  function stopDrawing() {
    if (isDrawing) {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      ctx?.restore();
    }
    setIsDrawing(false);
    lastDrawPointRef.current = null;
  }

  function startToolbarDrag(event: React.PointerEvent<HTMLButtonElement>) {
    if (!toolbarRef.current) return;
    const bounds = toolbarRef.current.getBoundingClientRect();
    toolbarDragRef.current = {
      offsetX: event.clientX - bounds.left,
      offsetY: event.clientY - bounds.top,
      startX: event.clientX,
      startY: event.clientY,
    };
    toolbarDidDragRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveToolbar(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = toolbarDragRef.current;
    const workspace = containerRef.current;
    const toolbar = toolbarRef.current;
    if (!drag || !workspace || !toolbar) return;

    if (Math.abs(event.clientX - drag.startX) > 3 || Math.abs(event.clientY - drag.startY) > 3) {
      toolbarDidDragRef.current = true;
    }
    if (!toolbarDidDragRef.current) return;

    const workspaceBounds = workspace.getBoundingClientRect();
    const toolbarBounds = toolbar.getBoundingClientRect();
    const maxLeft = Math.max(8, workspaceBounds.width - toolbarBounds.width - 8);
    const maxTop = Math.max(8, workspaceBounds.height - toolbarBounds.height - 8);
    setToolbarPosition({
      left: Math.min(maxLeft, Math.max(8, event.clientX - workspaceBounds.left - drag.offsetX)),
      top: Math.min(maxTop, Math.max(8, event.clientY - workspaceBounds.top - drag.offsetY)),
    });
  }

  function stopToolbarDrag() {
    toolbarDragRef.current = null;
  }

  function handleToolbarHandleClick() {
    if (toolbarDidDragRef.current) {
      toolbarDidDragRef.current = false;
      return;
    }
    setToolbarPosition(null);
  }

  // Mouse handlers
  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    startDrawing(e.clientX, e.clientY);
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    drawTo(e.clientX, e.clientY);
  }

  function handleMouseUp() {
    stopDrawing();
  }

  // Touch handlers for tablets/iPads/mobile
  function handleTouchStart(e: React.TouchEvent<HTMLCanvasElement>) {
    const touch = e.touches[0];
    if (touch) {
      startDrawing(touch.clientX, touch.clientY);
    }
  }

  function handleTouchMove(e: React.TouchEvent<HTMLCanvasElement>) {
    const touch = e.touches[0];
    if (touch) {
      drawTo(touch.clientX, touch.clientY);
    }
  }

  function handleTouchEnd() {
    stopDrawing();
  }

  function clearWhiteboard() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    realtime.sendWhiteboardClear();
  }

  function exportWhiteboardPng() {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height;
    const eCtx = exportCanvas.getContext("2d");
    if (!eCtx) return;

    eCtx.fillStyle = "#080c14";
    eCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    eCtx.drawImage(canvas, 0, 0);

    const link = document.createElement("a");
    link.download = `connectsphere_whiteboard_${Date.now()}.png`;
    link.href = exportCanvas.toDataURL("image/png");
    link.click();
  }

  // Toggle card task
  function toggleCardTask(cardId: string, taskIndex: number) {
    setCards((prev) =>
      prev.map((c) => {
        if (c.id !== cardId) return c;
        const updatedTasks = c.tasks.map((t, idx) =>
          idx === taskIndex ? { ...t, done: !t.done } : t
        );
        return { ...c, tasks: updatedTasks };
      })
    );
  }

  function addNewSprintCard(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = newCardTitle.trim();
    if (!title) return;

    const newCard: SprintCard = {
      id: `card-${Date.now()}`,
      title,
      tag: "Idea",
      color: newCardColor,
      tasks: newCardTasks
        .split("\n")
        .map((text) => text.trim())
        .filter(Boolean)
        .map((text) => ({ text, done: false })),
      x: 120 + Math.random() * 200,
      y: 120 + Math.random() * 150,
    };
    setCards((prev) => [...prev, newCard]);
    setShowAddCardModal(false);
    setNewCardTitle("");
    setNewCardTasks("");
    setNewCardColor("#f59e0b");
  }

  function closeAddCardModal() {
    setShowAddCardModal(false);
    setNewCardTitle("");
    setNewCardTasks("");
    setNewCardColor("#f59e0b");
  }

  function startSprintCardDrag(event: React.PointerEvent<HTMLButtonElement>, card: SprintCard) {
    if (event.button !== 0) return;
    const workspace = containerRef.current;
    const cardElement = event.currentTarget.closest<HTMLElement>(".sprint-planning-card");
    if (!workspace || !cardElement) return;

    event.preventDefault();
    const workspaceBounds = workspace.getBoundingClientRect();
    const cardBounds = cardElement.getBoundingClientRect();
    const offset = mobileCardOffsets[card.id] ?? { x: 0, y: 0 };
    const mobile = window.innerWidth <= 768;

    cardDragRef.current = {
      cardId: card.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      cardX: card.x,
      cardY: card.y,
      cardWidth: cardBounds.width,
      cardHeight: cardBounds.height,
      mobileBaseX: cardBounds.left - workspaceBounds.left - offset.x,
      mobileBaseY: cardBounds.top - workspaceBounds.top - offset.y,
      mobileOffsetX: offset.x,
      mobileOffsetY: offset.y,
      isMobile: mobile,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveSprintCard(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = cardDragRef.current;
    const workspace = containerRef.current;
    if (!drag || !workspace) return;

    const workspaceBounds = workspace.getBoundingClientRect();
    const deltaX = event.clientX - drag.startClientX;
    const deltaY = event.clientY - drag.startClientY;

    if (drag.isMobile) {
      const maxOffsetX = workspaceBounds.width - drag.cardWidth - 8 - drag.mobileBaseX;
      const maxOffsetY = workspaceBounds.height - drag.cardHeight - 8 - drag.mobileBaseY;
      const x = Math.min(maxOffsetX, Math.max(8 - drag.mobileBaseX, drag.mobileOffsetX + deltaX));
      const y = Math.min(maxOffsetY, Math.max(8 - drag.mobileBaseY, drag.mobileOffsetY + deltaY));
      setMobileCardOffsets((previous) => ({ ...previous, [drag.cardId]: { x, y } }));
      return;
    }

    const maxX = Math.max(8, workspaceBounds.width - drag.cardWidth - 8);
    const maxY = Math.max(8, workspaceBounds.height - drag.cardHeight - 8);
    setCards((previous) =>
      previous.map((card) =>
        card.id === drag.cardId
          ? {
              ...card,
              x: Math.min(maxX, Math.max(8, drag.cardX + deltaX)),
              y: Math.min(maxY, Math.max(8, drag.cardY + deltaY)),
            }
          : card
      )
    );
  }

  function stopSprintCardDrag() {
    cardDragRef.current = null;
  }

  function moveSprintCardWithKeyboard(
    event: React.KeyboardEvent<HTMLButtonElement>,
    card: SprintCard
  ) {
    const directions: Record<string, { x: number; y: number }> = {
      ArrowLeft: { x: -16, y: 0 },
      ArrowRight: { x: 16, y: 0 },
      ArrowUp: { x: 0, y: -16 },
      ArrowDown: { x: 0, y: 16 },
    };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();

    const workspace = containerRef.current;
    const cardElement = event.currentTarget.closest<HTMLElement>(".sprint-planning-card");
    if (!workspace || !cardElement) return;
    const workspaceBounds = workspace.getBoundingClientRect();
    const cardBounds = cardElement.getBoundingClientRect();

    if (isMobileLayout) {
      const offset = mobileCardOffsets[card.id] ?? { x: 0, y: 0 };
      const baseX = cardBounds.left - workspaceBounds.left - offset.x;
      const baseY = cardBounds.top - workspaceBounds.top - offset.y;
      setMobileCardOffsets((previous) => ({
        ...previous,
        [card.id]: {
          x: Math.min(
            workspaceBounds.width - cardBounds.width - 8 - baseX,
            Math.max(8 - baseX, offset.x + direction.x)
          ),
          y: Math.min(
            workspaceBounds.height - cardBounds.height - 8 - baseY,
            Math.max(8 - baseY, offset.y + direction.y)
          ),
        },
      }));
      return;
    }

    setCards((previous) =>
      previous.map((item) =>
        item.id === card.id
          ? {
              ...item,
              x: Math.min(
                workspaceBounds.width - cardBounds.width - 8,
                Math.max(8, item.x + direction.x)
              ),
              y: Math.min(
                workspaceBounds.height - cardBounds.height - 8,
                Math.max(8, item.y + direction.y)
              ),
            }
          : item
      )
    );
  }

  // Task list handlers
  function toggleTask(id: string) {
    const updated = tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t));
    setTasks(updated);
    onUpdateDoc({ ...doc, tasks: updated, content: noteContent });
    const task = updated.find((item) => item.id === id);
    if (task) realtime.sendCollabTask(id, task.done, task.text);
  }

  function addTask() {
    if (!newTaskText.trim()) return;
    const newTask = { id: `t-${Date.now()}`, text: newTaskText.trim(), done: false };
    const updated = [...tasks, newTask];
    setTasks(updated);
    setNewTaskText("");
    onUpdateDoc({ ...doc, tasks: updated, content: noteContent });
    realtime.sendCollabTask(newTask.id, false, newTask.text);
  }

  return (
    <div className="workspace-page-layout">
      {/* Top Header Dock */}
      <div className="workspace-header">
        <div className="workspace-header-left">
          <div className="workspace-tabs-group">
            <button
              type="button"
              className={`ws-tab-btn ${activeTab === "whiteboard" ? "is-active" : ""}`}
              onClick={() => setActiveTab("whiteboard")}
            >
              <Edit3 size={15} />
              <span>Whiteboard Studio</span>
            </button>
            <button
              type="button"
              className={`ws-tab-btn ${activeTab === "notes" ? "is-active" : ""}`}
              onClick={() => setActiveTab("notes")}
            >
              <FileText size={15} />
              <span>Shared Notes</span>
            </button>
          </div>

          <span className="workspace-badge">
            <span className="live-dot" /> Collaborative Canvas
          </span>
        </div>

        {/* Live Collaborators Presence */}
        <div className="active-collaborators-pill">
          <Users size={14} className="text-accent" />
          <span>{onlineCollaborators.length + 1} online</span>
          <div className="presence-avatars-stack">
            {onlineCollaborators.slice(0, 3).map((collab) => (
              <img
                key={collab.userId}
                className="mini-pip"
                src={getSafeAvatar(collab.avatar, collab.displayName)}
                alt=""
                title={collab.displayName || "Online user"}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Main Workspace Body */}
      <div className="workspace-body-container">
        {/* 1. Shared Whiteboard */}
        {activeTab === "whiteboard" && (
          <div className="whiteboard-workspace" ref={containerRef}>
            {/* Floating Studio Toolbar Dock */}
            <div
              ref={toolbarRef}
              className="whiteboard-control-bar"
              style={toolbarPosition ? {
                left: toolbarPosition.left,
                top: toolbarPosition.top,
                right: "auto",
                transform: "none",
              } : undefined}
            >
              <button
                type="button"
                className="whiteboard-toolbar-drag-handle"
                aria-label="Move toolbar; activate to reset its position"
                title="Drag to move the toolbar. Click to reset its position."
                onPointerDown={startToolbarDrag}
                onPointerMove={moveToolbar}
                onPointerUp={stopToolbarDrag}
                onPointerCancel={stopToolbarDrag}
                onClick={handleToolbarHandleClick}
              >
                <GripVertical size={16} />
                <span>Move tools</span>
              </button>

              {/* Tool selector */}
              <div className="tool-btn-group">
                <button
                  type="button"
                  className={`canvas-tool-pill ${tool === "pen" ? "is-active" : ""}`}
                  onClick={() => setTool("pen")}
                  aria-pressed={tool === "pen"}
                >
                  <PenTool size={13} />
                  <span>Pen</span>
                </button>
                <button
                  type="button"
                  className={`canvas-tool-pill ${tool === "highlighter" ? "is-active" : ""}`}
                  onClick={() => setTool("highlighter")}
                  aria-pressed={tool === "highlighter"}
                >
                  <Highlighter size={13} />
                  <span>Highlighter</span>
                </button>
                <button
                  type="button"
                  className={`canvas-tool-pill ${tool === "eraser" ? "is-active" : ""}`}
                  onClick={() => setTool("eraser")}
                  aria-pressed={tool === "eraser"}
                >
                  <Eraser size={13} />
                  <span>Eraser</span>
                </button>
              </div>

              {/* Color swatches */}
              <div className="palette-row">
                {["#00a884", "#6366f1", "#f43f5e", "#fbbf24", "#06b6d4", "#ffffff"].map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`palette-color ${drawColor === c ? "is-selected" : ""}`}
                    style={{ backgroundColor: c }}
                    onClick={() => setDrawColor(c)}
                    aria-label={`Set pen color ${c}`}
                    aria-pressed={drawColor === c}
                  />
                ))}
              </div>

              {/* Stroke width */}
              <div className="stroke-slider-wrap">
                <span className="slider-label">Width:</span>
                <input
                  type="range"
                  min={1}
                  max={12}
                  value={strokeWidth}
                  onChange={(e) => setStrokeWidth(Number(e.target.value))}
                  className="stroke-range-slider"
                  aria-label="Brush width"
                />
              </div>

              {/* Sprint cards toggle */}
              <button
                type="button"
                className={`secondary-btn ${showCards ? "is-active" : ""}`}
                onClick={() => setShowCards((prev) => !prev)}
                title={showCards ? "Hide Sprint & Planning Cards" : "Show Sprint & Planning Cards"}
                aria-label={showCards ? "Hide planning cards" : "Show planning cards"}
                aria-pressed={showCards}
              >
                <StickyNote size={14} />
                <span>Cards</span>
              </button>

              <button
                type="button"
                className="secondary-btn"
                onClick={() => setShowAddCardModal(true)}
                title="Add New Planning Card"
              >
                <Plus size={14} />
                <span>Add Card</span>
              </button>

              {/* Export / Clear */}
              <div className="canvas-actions-right">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={clearWhiteboard}
                  title="Clear drawing"
                >
                  <Trash2 size={14} />
                  <span>Clear</span>
                </button>
                <button
                  type="button"
                  className="primary-action-btn"
                  onClick={exportWhiteboardPng}
                  title="Export Whiteboard to PNG"
                >
                  <Download size={14} />
                  <span>Export PNG</span>
                </button>
              </div>
            </div>

            {/* Canvas Scroll / Draw Stage */}
            <div className="canvas-fullbleed-wrapper">
              <canvas
                ref={canvasRef}
                className="full-whiteboard-canvas"
                style={{
                  transform: `scale(${zoomLevel / 100})`,
                  transformOrigin: "top left",
                }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onTouchCancel={handleTouchEnd}
              />

              {/* Sprint Planning Backlog Cards (matching Reference Image 3) */}
              {showCards && (
                <div className="whiteboard-cards-layer">
                  {cards.map((card) => {
                    const mobileOffset = mobileCardOffsets[card.id];
                    return (
                    <div
                      key={card.id}
                      className="sprint-planning-card"
                      style={{
                        left: `${card.x}px`,
                        top: `${card.y}px`,
                        borderColor: card.color,
                        boxShadow: `0 8px 30px ${card.color}22`,
                        transform: isMobileLayout && mobileOffset
                          ? `translate(${mobileOffset.x}px, ${mobileOffset.y}px)`
                          : undefined,
                      }}
                    >
                      <div className="card-header-bar">
                        <div className="card-header-leading">
                          <button
                            type="button"
                            className="card-drag-handle"
                            aria-label={`Drag ${card.title} card`}
                            title="Drag card"
                            onPointerDown={(event) => startSprintCardDrag(event, card)}
                            onPointerMove={moveSprintCard}
                            onPointerUp={stopSprintCardDrag}
                            onPointerCancel={stopSprintCardDrag}
                            onLostPointerCapture={stopSprintCardDrag}
                            onKeyDown={(event) => moveSprintCardWithKeyboard(event, card)}
                          >
                            <GripVertical size={14} />
                          </button>
                          <span className="card-tag" style={{ backgroundColor: `${card.color}22`, color: card.color }}>
                            {card.tag}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="card-remove-btn"
                          aria-label={`Remove ${card.title} card`}
                          onClick={() => setCards((prev) => prev.filter((c) => c.id !== card.id))}
                        >
                          <X size={12} />
                        </button>
                      </div>
                      <h4 className="card-title">{card.title}</h4>
                      <div className="card-tasks-list">
                        {card.tasks.map((task, idx) => (
                          <div
                            key={idx}
                            className={`card-task-row ${task.done ? "is-done" : ""}`}
                            onClick={() => toggleCardTask(card.id, idx)}
                          >
                            <span className="task-checkbox">
                              {task.done ? <Check size={11} /> : null}
                            </span>
                            <span className="task-text">{task.text}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Floating Zoom HUD */}
            <div className="canvas-zoom-hud">
              <button
                type="button"
                className="hud-btn"
                onClick={() => setZoomLevel((prev) => Math.max(50, prev - 10))}
                title="Zoom Out"
              >
                <Minus size={14} />
              </button>
              <span className="hud-zoom-text">{zoomLevel}%</span>
              <button
                type="button"
                className="hud-btn"
                onClick={() => setZoomLevel((prev) => Math.min(200, prev + 10))}
                title="Zoom In"
              >
                <Plus size={14} />
              </button>
              <button
                type="button"
                className="hud-btn"
                onClick={() => setZoomLevel(100)}
                title="Reset Zoom to 100%"
              >
                <RotateCcw size={12} />
              </button>
            </div>

            {showAddCardModal && (
              <div
                className="modal-backdrop workspace-card-modal-backdrop"
                onClick={closeAddCardModal}
              >
                <section
                  className="modal-card enhanced-chat-modal workspace-add-card-modal"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="workspace-add-card-title"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="new-chat-modal-header">
                    <div className="new-chat-header-brand">
                      <div className="new-chat-header-icon-wrap">
                        <StickyNote size={20} />
                      </div>
                      <div>
                        <h3 id="workspace-add-card-title" className="new-chat-title">New Planning Card</h3>
                        <p className="new-chat-subtitle">Write a title and checklist before adding it.</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="modal-close-btn"
                      onClick={closeAddCardModal}
                      aria-label="Close new planning card form"
                    >
                      <X size={18} />
                    </button>
                  </div>

                  <form className="enhanced-modal-body" onSubmit={addNewSprintCard}>
                    <div className="field-group">
                      <label className="field-label" htmlFor="workspace-card-title">Card title</label>
                      <div className="enhanced-input-wrapper">
                        <input
                          id="workspace-card-title"
                          className="enhanced-text-field"
                          value={newCardTitle}
                          onChange={(event) => setNewCardTitle(event.target.value)}
                          placeholder="e.g. Plan the next sprint"
                          maxLength={80}
                          autoFocus
                          required
                        />
                      </div>
                    </div>

                    <fieldset className="workspace-card-color-field">
                      <legend className="field-label">Card color</legend>
                      <div className="workspace-card-color-picker" role="group" aria-label="Choose card color">
                        {CARD_COLOR_OPTIONS.map((color) => (
                          <button
                            key={color.value}
                            type="button"
                            className={`workspace-card-color-option ${newCardColor === color.value ? "is-selected" : ""}`}
                            style={{ backgroundColor: color.value }}
                            onClick={() => setNewCardColor(color.value)}
                            aria-label={`${color.name} card color`}
                            aria-pressed={newCardColor === color.value}
                            title={color.name}
                          />
                        ))}
                      </div>
                    </fieldset>

                    <div className="field-group">
                      <label className="field-label" htmlFor="workspace-card-tasks">
                        Checklist items <span className="workspace-card-optional">(optional, one per line)</span>
                      </label>
                      <textarea
                        id="workspace-card-tasks"
                        className="workspace-card-tasks-input"
                        value={newCardTasks}
                        onChange={(event) => setNewCardTasks(event.target.value)}
                        placeholder={"Define the goal\nAdd the first action item"}
                        rows={4}
                        maxLength={600}
                      />
                    </div>

                    <div className="modal-footer-btns">
                      <button
                        type="button"
                        className="secondary-btn"
                        onClick={closeAddCardModal}
                      >
                        Cancel
                      </button>
                      <button type="submit" className="primary-action-btn enhanced-start-btn">
                        <Plus size={16} />
                        <span>Add Card</span>
                      </button>
                    </div>
                  </form>
                </section>
              </div>
            )}
          </div>
        )}

        {/* 2. Shared Notes & Task List */}
        {activeTab === "notes" && (
          <div className="notes-workspace-split">
            {/* Left: Realtime Scratchpad Document */}
            <div className="notes-editor-pane">
              <div className="pane-header">
                <h3>Collaborative Markdown Scratchpad</h3>
                <span className="save-status-tag">
                  <Check size={12} className="text-success" /> Auto-saved in real time
                </span>
              </div>
              <textarea
                className="shared-scratchpad-input"
                placeholder="# Sprint Notes &amp; Project Scratchpad&#10;&#10;Write team notes, meeting outlines, or shared snippets here in real time..."
                value={noteContent}
                onChange={(e) => {
                  const content = e.target.value;
                  setNoteContent(content);
                  if (noteSyncTimerRef.current !== null) window.clearTimeout(noteSyncTimerRef.current);
                  noteSyncTimerRef.current = window.setTimeout(() => {
                    onUpdateDoc({ ...doc, content, tasks });
                    realtime.sendCollabNotes(content);
                  }, 150);
                }}
              />
            </div>

            {/* Right: Interactive Collaborative Sprint Tasks */}
            <div className="notes-tasks-pane">
              <div className="pane-header">
                <h3>Sprint Deliverables</h3>
                <span className="tasks-count-tag">
                  {tasks.filter((t) => t.done).length} / {tasks.length} Done
                </span>
              </div>

              {/* Add Task Input */}
              <div className="add-task-bar">
                <input
                  type="text"
                  placeholder="Add a new deliverable or action item..."
                  value={newTaskText}
                  onChange={(e) => setNewTaskText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addTask();
                  }}
                  className="add-task-input"
                />
                <button type="button" className="add-task-btn" onClick={addTask} disabled={!newTaskText.trim()}>
                  <Plus size={15} /> Add
                </button>
              </div>

              {/* Task items list */}
              <div className="collab-tasks-list">
                {tasks.map((task) => (
                  <div
                    key={task.id}
                    className={`collab-task-item ${task.done ? "is-done" : ""}`}
                    onClick={() => toggleTask(task.id)}
                  >
                    <span className="task-checkbox-circle">
                      {task.done ? <Check size={12} strokeWidth={3} /> : null}
                    </span>
                    <span className="collab-task-label">{task.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
