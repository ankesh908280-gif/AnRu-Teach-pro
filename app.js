/**
 * ============================================================================
 * AnRu Teach — Mobile Teaching Whiteboard & Slide Annotation Engine
 * ============================================================================
 * Production-ready JavaScript for PWA / Mobile / Stylus landscape teaching.
 */

'use strict';

// ============================================================================
// State Management & Constants
// ============================================================================
const CONFIG = {
  defaultAspect: 16 / 9, // Standard presentation ratio (Canva / PowerPoint)
  minSize: 2,
  maxSize: 48,
  highlighterAlpha: 0.45,
  highlighterMultiplier: 2.2,
  maxUndoSteps: 25
};

// Application State
const state = {
  currentTool: 'pen', // 'pen' | 'highlighter' | 'eraser'
  currentColor: '#00e5ff', // Neon Blue default
  currentSize: 6,
  isDrawing: false,
  dockPosition: 'bottom', // 'bottom' | 'left'
  isToolbarCollapsed: false,
  
  // Slides Deck
  slides: [],
  currentSlideIndex: 0,
  
  // Per-slide Undo / Redo Stacks: Array of { undo: [], redo: [] }
  history: []
};

// ============================================================================
// DOM Elements Cache
// ============================================================================
const DOM = {
  app: document.getElementById('app'),
  topNav: document.getElementById('topNav'),
  bgCanvas: document.getElementById('bgCanvas'),
  drawCanvas: document.getElementById('drawCanvas'),
  canvasWrapper: document.getElementById('canvasWrapper'),
  canvasViewport: document.getElementById('canvasViewport'),
  dropzonePrompt: document.getElementById('dropzonePrompt'),
  slideUploadInput: document.getElementById('slideUploadInput'),
  quickUploadBtn: document.getElementById('quickUploadBtn'),
  startBlankBtn: document.getElementById('startBlankBtn'),
  addBlankSlideBtn: document.getElementById('addBlankSlideBtn'),
  prevSlideBtn: document.getElementById('prevSlideBtn'),
  nextSlideBtn: document.getElementById('nextSlideBtn'),
  currentSlideNum: document.getElementById('currentSlideNum'),
  totalSlidesNum: document.getElementById('totalSlidesNum'),
  undoBtn: document.getElementById('undoBtn'),
  redoBtn: document.getElementById('redoBtn'),
  exportSlideBtn: document.getElementById('exportSlideBtn'),
  fullscreenBtn: document.getElementById('fullscreenBtn'),
  teacherToolbar: document.getElementById('teacherToolbar'),
  toolbarToggleBtn: document.getElementById('toolbarToggleBtn'),
  dockPositionBtn: document.getElementById('dockPositionBtn'),
  clearBoardBtn: document.getElementById('clearBoardBtn'),
  sizeSlider: document.getElementById('sizeSlider'),
  sizeBadge: document.getElementById('sizeBadge'),
  colorButtons: document.querySelectorAll('.color-btn'),
  sizePresetButtons: document.querySelectorAll('.size-preset-btn'),
  toolButtons: document.querySelectorAll('.tool-btn'),
  landscapeBanner: document.getElementById('landscapeBanner'),
  dismissBannerBtn: document.getElementById('dismissBannerBtn'),
  clearModal: document.getElementById('clearModal'),
  cancelClearBtn: document.getElementById('cancelClearBtn'),
  confirmClearBtn: document.getElementById('confirmClearBtn')
};

// Canvas 2D Rendering Contexts
const bgCtx = DOM.bgCanvas.getContext('2d');
const drawCtx = DOM.drawCanvas.getContext('2d', { willReadFrequently: true });

// Stroke smoothing point buffer
let strokePoints = [];

// ============================================================================
// Slide Deck Manager
// ============================================================================
class SlideManager {
  /**
   * Initializes the slide deck with an initial blank slide
   */
  static init() {
    this.addSlide({ type: 'blank', title: 'Whiteboard 1' });
    this.updateNavigationUI();
    this.renderCurrentSlide();
  }

  /**
   * Adds a new slide to the deck
   * @param {Object} slideData - { type: 'blank' | 'image', img: Image | null, title: String }
   */
  static addSlide(slideData) {
    const newSlide = {
      id: Date.now() + Math.random(),
      type: slideData.type || 'blank',
      title: slideData.title || `Slide ${state.slides.length + 1}`,
      img: slideData.img || null,
      drawingData: null // Saved DataURL of annotations
    };
    state.slides.push(newSlide);
    state.history.push({ undo: [], redo: [] });
  }

  /**
   * Switches to slide by index, saving current annotations first
   * @param {Number} targetIndex
   */
  static goToSlide(targetIndex) {
    if (targetIndex < 0 || targetIndex >= state.slides.length || targetIndex === state.currentSlideIndex) {
      return;
    }

    // 1. Save current drawing state to the active slide
    this.saveCurrentSlideAnnotations();

    // 2. Change index
    state.currentSlideIndex = targetIndex;

    // 3. Update UI & re-render
    this.updateNavigationUI();
    CanvasEngine.resizeAndFit();
    this.renderCurrentSlide();
  }

  /**
   * Saves annotations of current active slide into memory
   */
  static saveCurrentSlideAnnotations() {
    const activeSlide = state.slides[state.currentSlideIndex];
    if (activeSlide) {
      activeSlide.drawingData = DOM.drawCanvas.toDataURL();
    }
  }

  /**
   * Renders the current slide background and restores saved annotations
   */
  static renderCurrentSlide() {
    const activeSlide = state.slides[state.currentSlideIndex];
    if (!activeSlide) return;

    // A. Render Background
    CanvasEngine.renderBackground(activeSlide);

    // B. Restore Annotations
    drawCtx.clearRect(0, 0, DOM.drawCanvas.width, DOM.drawCanvas.height);
    if (activeSlide.drawingData) {
      const img = new Image();
      img.onload = () => {
        drawCtx.drawImage(img, 0, 0, DOM.drawCanvas.width, DOM.drawCanvas.height);
        CanvasEngine.updateUndoRedoUI();
      };
      img.src = activeSlide.drawingData;
    } else {
      CanvasEngine.updateUndoRedoUI();
    }
  }

  /**
   * Updates previous/next buttons and counter
   */
  static updateNavigationUI() {
    const total = state.slides.length;
    const current = state.currentSlideIndex + 1;

    DOM.currentSlideNum.textContent = current;
    DOM.totalSlidesNum.textContent = total;

    DOM.prevSlideBtn.disabled = state.currentSlideIndex <= 0;
    DOM.nextSlideBtn.disabled = state.currentSlideIndex >= total - 1;
  }

  /**
   * Handles user uploaded images (e.g. exported Canva slides)
   * @param {FileList} files
   */
  static async handleUploadedFiles(files) {
    if (!files || files.length === 0) return;

    const fileList = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (fileList.length === 0) {
      alert('Please select valid image files (PNG or JPG).');
      return;
    }

    // Sort files naturally by name (e.g. Slide 1, Slide 2, ..., Slide 10)
    fileList.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    // Save annotations of current slide first
    this.saveCurrentSlideAnnotations();

    // Check if the only existing slide is an untouched initial blank slide
    const isSingleBlank = state.slides.length === 1 && state.slides[0].type === 'blank' && !state.slides[0].drawingData;
    if (isSingleBlank) {
      state.slides = [];
      state.history = [];
    }

    const startIndex = state.slides.length;

    // Load each image
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const dataUrl = await this.readFileAsDataURL(file);
      const img = await this.loadImage(dataUrl);

      this.addSlide({
        type: 'image',
        title: file.name,
        img: img
      });
    }

    // Dismiss dropzone overlay
    DOM.dropzonePrompt.classList.add('hidden');

    // Navigate to the newly uploaded first slide
    state.currentSlideIndex = startIndex;
    this.updateNavigationUI();
    CanvasEngine.resizeAndFit();
    this.renderCurrentSlide();
  }

  static readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  static loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }
}

// ============================================================================
// Canvas Engine & Drawing Logic
// ============================================================================
class CanvasEngine {
  static dpr = window.devicePixelRatio || 1;
  static cssWidth = 0;
  static cssHeight = 0;

  /**
   * Fits canvas inside the viewport maintaining slide aspect ratio
   */
  static resizeAndFit() {
    const activeSlide = state.slides[state.currentSlideIndex];
    let targetRatio = CONFIG.defaultAspect;

    if (activeSlide && activeSlide.img) {
      targetRatio = activeSlide.img.naturalWidth / activeSlide.img.naturalHeight;
    }

    const vpRect = DOM.canvasViewport.getBoundingClientRect();
    const paddingX = 24;
    const paddingY = 140; // Clearance for top header and bottom toolbar

    const maxW = Math.max(300, vpRect.width - paddingX);
    const maxH = Math.max(200, vpRect.height - paddingY);

    let finalW = maxW;
    let finalH = finalW / targetRatio;

    if (finalH > maxH) {
      finalH = maxH;
      finalW = finalH * targetRatio;
    }

    this.cssWidth = Math.floor(finalW);
    this.cssHeight = Math.floor(finalH);

    // Set CSS dimensions on wrapper
    DOM.canvasWrapper.style.width = `${this.cssWidth}px`;
    DOM.canvasWrapper.style.height = `${this.cssHeight}px`;

    // Scale canvas internal resolution for Retina/High-DPI displays
    this.dpr = window.devicePixelRatio || 1;
    const bufferW = Math.floor(this.cssWidth * this.dpr);
    const bufferH = Math.floor(this.cssHeight * this.dpr);

    // Save previous drawing content to avoid blanking during resize
    const prevDrawing = DOM.drawCanvas.toDataURL();

    [DOM.bgCanvas, DOM.drawCanvas].forEach(canvas => {
      canvas.width = bufferW;
      canvas.height = bufferH;
      canvas.style.width = `${this.cssWidth}px`;
      canvas.style.height = `${this.cssHeight}px`;
    });

    // Reset transform scale
    bgCtx.resetTransform ? bgCtx.resetTransform() : bgCtx.setTransform(1, 0, 0, 1, 0, 0);
    drawCtx.resetTransform ? drawCtx.resetTransform() : drawCtx.setTransform(1, 0, 0, 1, 0, 0);

    bgCtx.scale(this.dpr, this.dpr);
    drawCtx.scale(this.dpr, this.dpr);

    // Re-render background
    this.renderBackground(activeSlide);

    // Restore annotations
    if (activeSlide && activeSlide.drawingData) {
      const img = new Image();
      img.onload = () => {
        drawCtx.drawImage(img, 0, 0, this.cssWidth, this.cssHeight);
      };
      img.src = activeSlide.drawingData;
    } else if (prevDrawing) {
      const img = new Image();
      img.onload = () => {
        drawCtx.drawImage(img, 0, 0, this.cssWidth, this.cssHeight);
      };
      img.src = prevDrawing;
    }
  }

  /**
   * Draws background image or blank blackboard grid onto bgCanvas
   * @param {Object} slide
   */
  static renderBackground(slide) {
    if (!slide) return;

    bgCtx.clearRect(0, 0, this.cssWidth, this.cssHeight);

    if (slide.type === 'image' && slide.img) {
      // Draw slide image with object-fit: contain
      bgCtx.drawImage(slide.img, 0, 0, this.cssWidth, this.cssHeight);
    } else {
      // Draw modern dark chalkboard / whiteboard
      bgCtx.fillStyle = '#181822';
      bgCtx.fillRect(0, 0, this.cssWidth, this.cssHeight);

      // Subtle teaching grid lines
      bgCtx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
      bgCtx.lineWidth = 1;
      const gridSize = 40;

      bgCtx.beginPath();
      for (let x = 0; x <= this.cssWidth; x += gridSize) {
        bgCtx.moveTo(x, 0);
        bgCtx.lineTo(x, this.cssHeight);
      }
      for (let y = 0; y <= this.cssHeight; y += gridSize) {
        bgCtx.moveTo(0, y);
        bgCtx.lineTo(this.cssWidth, y);
      }
      bgCtx.stroke();
    }
  }

  /**
   * Translates client viewport coordinates to Canvas logical coordinates
   * @param {PointerEvent|TouchEvent} e
   * @returns {Object} { x, y }
   */
  static getCanvasCoords(e) {
    const rect = DOM.drawCanvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  }

  /**
   * Saves current snapshot to Undo stack
   */
  static pushUndoSnapshot() {
    const curHist = state.history[state.currentSlideIndex];
    if (!curHist) return;

    // Save dataURL snapshot
    const snapshot = DOM.drawCanvas.toDataURL();
    curHist.undo.push(snapshot);
    if (curHist.undo.length > CONFIG.maxUndoSteps) {
      curHist.undo.shift();
    }
    // New action invalidates redo stack
    curHist.redo = [];
    this.updateUndoRedoUI();
  }

  static undo() {
    const curHist = state.history[state.currentSlideIndex];
    if (!curHist || curHist.undo.length === 0) return;

    // Push current to redo
    const currentSnapshot = DOM.drawCanvas.toDataURL();
    curHist.redo.push(currentSnapshot);

    const previousSnapshot = curHist.undo.pop();
    this.restoreSnapshot(previousSnapshot);
    this.updateUndoRedoUI();
  }

  static redo() {
    const curHist = state.history[state.currentSlideIndex];
    if (!curHist || curHist.redo.length === 0) return;

    // Push current to undo
    const currentSnapshot = DOM.drawCanvas.toDataURL();
    curHist.undo.push(currentSnapshot);

    const nextSnapshot = curHist.redo.pop();
    this.restoreSnapshot(nextSnapshot);
    this.updateUndoRedoUI();
  }

  static restoreSnapshot(dataUrl) {
    const img = new Image();
    img.onload = () => {
      drawCtx.clearRect(0, 0, this.cssWidth, this.cssHeight);
      drawCtx.drawImage(img, 0, 0, this.cssWidth, this.cssHeight);
      SlideManager.saveCurrentSlideAnnotations();
    };
    img.src = dataUrl;
  }

  static updateUndoRedoUI() {
    const curHist = state.history[state.currentSlideIndex];
    DOM.undoBtn.disabled = !curHist || curHist.undo.length === 0;
    DOM.redoBtn.disabled = !curHist || curHist.redo.length === 0;
  }

  static clearCurrentSlide() {
    this.pushUndoSnapshot();
    drawCtx.clearRect(0, 0, this.cssWidth, this.cssHeight);
    SlideManager.saveCurrentSlideAnnotations();
    this.updateUndoRedoUI();
  }
}

// ============================================================================
// Touch & Pointer Drawing Event Handlers
// ============================================================================
function handlePointerDown(e) {
  // Only accept primary touch / stylus / mouse button
  if (e.button !== undefined && e.button !== 0) return;
  e.preventDefault();

  state.isDrawing = true;
  CanvasEngine.pushUndoSnapshot();

  const coords = CanvasEngine.getCanvasCoords(e);
  strokePoints = [coords];

  // Configure context styling for current tool
  configureDrawingContext();

  // Draw initial dot
  drawCtx.beginPath();
  drawCtx.arc(coords.x, coords.y, getEffectiveStrokeSize() / 2, 0, Math.PI * 2);
  drawCtx.fill();

  if (DOM.drawCanvas.setPointerCapture && e.pointerId) {
    DOM.drawCanvas.setPointerCapture(e.pointerId);
  }
}

function handlePointerMove(e) {
  if (!state.isDrawing) return;
  e.preventDefault();

  const coords = CanvasEngine.getCanvasCoords(e);
  strokePoints.push(coords);

  if (strokePoints.length < 3) {
    const b = strokePoints[0];
    drawCtx.beginPath();
    drawCtx.arc(b.x, b.y, getEffectiveStrokeSize() / 2, 0, Math.PI * 2);
    drawCtx.fill();
    return;
  }

  // Smooth curve drawing using quadratic bezier midpoints
  drawCtx.beginPath();
  drawCtx.moveTo(strokePoints[0].x, strokePoints[0].y);

  for (let i = 1; i < strokePoints.length - 2; i++) {
    const c = (strokePoints[i].x + strokePoints[i + 1].x) / 2;
    const d = (strokePoints[i].y + strokePoints[i + 1].y) / 2;
    drawCtx.quadraticCurveTo(strokePoints[i].x, strokePoints[i].y, c, d);
  }

  // Curve through the last two points
  const lastIndex = strokePoints.length - 2;
  drawCtx.quadraticCurveTo(
    strokePoints[lastIndex].x,
    strokePoints[lastIndex].y,
    strokePoints[lastIndex + 1].x,
    strokePoints[lastIndex + 1].y
  );

  drawCtx.stroke();
}

function handlePointerUp(e) {
  if (!state.isDrawing) return;
  e.preventDefault();
  state.isDrawing = false;
  strokePoints = [];

  if (DOM.drawCanvas.releasePointerCapture && e.pointerId) {
    try {
      DOM.drawCanvas.releasePointerCapture(e.pointerId);
    } catch (_) {}
  }

  // Persist annotations to current slide
  SlideManager.saveCurrentSlideAnnotations();
}

/**
 * Sets line styles, colors, and composite operation for active tool
 */
function configureDrawingContext() {
  const size = getEffectiveStrokeSize();

  drawCtx.lineWidth = size;
  drawCtx.lineCap = 'round';
  drawCtx.lineJoin = 'round';

  if (state.currentTool === 'eraser') {
    // ERASER: Uses 'destination-out' to erase ONLY the annotation canvas
    // Background slide canvas underneath remains completely protected!
    drawCtx.globalCompositeOperation = 'destination-out';
    drawCtx.strokeStyle = 'rgba(0,0,0,1)';
    drawCtx.fillStyle = 'rgba(0,0,0,1)';
  } else if (state.currentTool === 'highlighter') {
    // HIGHLIGHTER: Translucent yellow with normal blending
    drawCtx.globalCompositeOperation = 'source-over';
    drawCtx.strokeStyle = 'rgba(255, 235, 59, 0.45)';
    drawCtx.fillStyle = 'rgba(255, 235, 59, 0.45)';
  } else {
    // PEN TOOL: Selected vibrant neon color
    drawCtx.globalCompositeOperation = 'source-over';
    drawCtx.strokeStyle = state.currentColor;
    drawCtx.fillStyle = state.currentColor;
  }
}

function getEffectiveStrokeSize() {
  if (state.currentTool === 'highlighter') {
    return state.currentSize * CONFIG.highlighterMultiplier;
  }
  if (state.currentTool === 'eraser') {
    return state.currentSize * 2.5;
  }
  return state.currentSize;
}

// ============================================================================
// Toolbar & UI Controller
// ============================================================================
function setupToolbarEvents() {
  // 1. Tool Selection (Pen, Highlighter, Eraser)
  DOM.toolButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      DOM.toolButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentTool = btn.dataset.tool;

      // Update cursor indicator
      DOM.drawCanvas.style.cursor = state.currentTool === 'eraser' ? 'cell' : 'crosshair';
    });
  });

  // 2. Color Palette Buttons
  DOM.colorButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      DOM.colorButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentColor = btn.dataset.color;

      // Automatically switch to Pen tool if currently on Eraser or Highlighter
      if (state.currentTool === 'eraser') {
        const penBtn = document.getElementById('penToolBtn');
        penBtn.click();
      }
    });
  });

  // 3. Pen Size Presets
  DOM.sizePresetButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      DOM.sizePresetButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const sizeVal = parseInt(btn.dataset.size, 10);
      state.currentSize = sizeVal;
      DOM.sizeSlider.value = sizeVal;
      DOM.sizeBadge.textContent = `${sizeVal}px`;
    });
  });

  // 4. Pen Size Slider
  DOM.sizeSlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    state.currentSize = val;
    DOM.sizeBadge.textContent = `${val}px`;

    // Sync preset active state
    DOM.sizePresetButtons.forEach(b => {
      b.classList.toggle('active', parseInt(b.dataset.size, 10) === val);
    });
  });

  // 5. Clear Board Modal & Actions
  DOM.clearBoardBtn.addEventListener('click', () => {
    DOM.clearModal.classList.remove('hidden');
  });

  DOM.cancelClearBtn.addEventListener('click', () => {
    DOM.clearModal.classList.add('hidden');
  });

  DOM.confirmClearBtn.addEventListener('click', () => {
    DOM.clearModal.classList.add('hidden');
    CanvasEngine.clearCurrentSlide();
  });

  // 6. Dock Switcher (Bottom Dock <-> Left Side Dock)
  DOM.dockPositionBtn.addEventListener('click', () => {
    if (state.dockPosition === 'bottom') {
      state.dockPosition = 'left';
      DOM.teacherToolbar.classList.remove('dock-bottom');
      DOM.teacherToolbar.classList.add('dock-left');
    } else {
      state.dockPosition = 'bottom';
      DOM.teacherToolbar.classList.remove('dock-left');
      DOM.teacherToolbar.classList.add('dock-bottom');
    }
  });

  // 7. Toolbar Collapse / Expand Handle
  DOM.toolbarToggleBtn.addEventListener('click', () => {
    state.isToolbarCollapsed = !state.isToolbarCollapsed;
    DOM.teacherToolbar.classList.toggle('collapsed', state.isToolbarCollapsed);
  });

  // 8. Fullscreen Toggle
  DOM.fullscreenBtn.addEventListener('click', toggleFullscreen);

  // 9. Undo / Redo
  DOM.undoBtn.addEventListener('click', () => CanvasEngine.undo());
  DOM.redoBtn.addEventListener('click', () => CanvasEngine.redo());

  // 10. Slide Navigation
  DOM.prevSlideBtn.addEventListener('click', () => SlideManager.goToSlide(state.currentSlideIndex - 1));
  DOM.nextSlideBtn.addEventListener('click', () => SlideManager.goToSlide(state.currentSlideIndex + 1));

  // 11. Add Blank Slide
  DOM.addBlankSlideBtn.addEventListener('click', () => {
    SlideManager.saveCurrentSlideAnnotations();
    SlideManager.addSlide({ type: 'blank', title: `Whiteboard ${state.slides.length + 1}` });
    SlideManager.goToSlide(state.slides.length - 1);
  });

  // 12. Upload Slides
  DOM.slideUploadInput.addEventListener('change', (e) => {
    SlideManager.handleUploadedFiles(e.target.files);
    e.target.value = ''; // Reset input to allow re-uploading same file
  });

  DOM.quickUploadBtn.addEventListener('click', () => DOM.slideUploadInput.click());
  DOM.startBlankBtn.addEventListener('click', () => DOM.dropzonePrompt.classList.add('hidden'));

  // 13. Export Slide Image with Annotations
  DOM.exportSlideBtn.addEventListener('click', exportAnnotatedSlide);

  // 14. Orientation Notice Dismiss
  DOM.dismissBannerBtn.addEventListener('click', () => {
    DOM.landscapeBanner.classList.add('hidden');
  });
}

/**
 * Toggles Fullscreen API with cross-browser prefixes
 */
function toggleFullscreen() {
  const enterIcon = DOM.fullscreenBtn.querySelector('.enter-fullscreen-icon');
  const exitIcon = DOM.fullscreenBtn.querySelector('.exit-fullscreen-icon');

  if (!document.fullscreenElement && !document.webkitFullscreenElement) {
    const el = document.documentElement;
    if (el.requestFullscreen) {
      el.requestFullscreen();
    } else if (el.webkitRequestFullscreen) {
      el.webkitRequestFullscreen();
    }
    enterIcon.classList.add('hidden');
    exitIcon.classList.remove('hidden');
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
    enterIcon.classList.remove('hidden');
    exitIcon.classList.add('hidden');
  }
}

/**
 * Merges background and annotations onto an offscreen canvas and triggers PNG download
 */
function exportAnnotatedSlide() {
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = DOM.drawCanvas.width;
  exportCanvas.height = DOM.drawCanvas.height;
  const ctx = exportCanvas.getContext('2d');

  // Draw background first
  ctx.drawImage(DOM.bgCanvas, 0, 0);
  // Overlay drawing
  ctx.drawImage(DOM.drawCanvas, 0, 0);

  const link = document.createElement('a');
  link.download = `AnRu_Teach_Slide_${state.currentSlideIndex + 1}.png`;
  link.href = exportCanvas.toDataURL('image/png');
  link.click();
}

// ============================================================================
// Mobile Landscape Orientation Detection
// ============================================================================
function checkOrientation() {
  const isPortrait = window.innerHeight > window.innerWidth;
  if (isPortrait) {
    DOM.landscapeBanner.classList.remove('hidden');
  } else {
    DOM.landscapeBanner.classList.add('hidden');
  }
}

// ============================================================================
// Service Worker Registration (PWA Offline Capability)
// ============================================================================
// ============================================================================
// Service Worker & PWA Installability Engine
// ============================================================================
let deferredPrompt = null;

function setupPWAInstallation() {
  const installBtn = document.getElementById('installPwaBtn');
  const quickInstallBtn = document.getElementById('quickInstallBtn');

  // Check if running in standalone mode (already installed)
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (isStandalone) {
    if (installBtn) installBtn.classList.add('hidden');
    if (quickInstallBtn) quickInstallBtn.classList.add('hidden');
    console.log('[AnRu Teach] Running in standalone PWA mode.');
  }

  // Capture beforeinstallprompt event for Android / Chrome
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    console.log('[AnRu Teach] beforeinstallprompt event captured! App is installable.');

    if (installBtn) installBtn.classList.remove('hidden');
    if (quickInstallBtn) quickInstallBtn.classList.remove('hidden');
  });

  // Handler for install buttons
  const triggerInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log('[AnRu Teach] User install choice:', outcome);
      deferredPrompt = null;
      if (installBtn) installBtn.classList.add('hidden');
      if (quickInstallBtn) quickInstallBtn.classList.add('hidden');
    } else {
      alert('To install AnRu Teach on your phone:
1. Tap the Chrome menu (⋮) in the top-right corner.
2. Tap "Install app" (या "Add to Home screen").');
    }
  };

  if (installBtn) installBtn.addEventListener('click', triggerInstall);
  if (quickInstallBtn) quickInstallBtn.addEventListener('click', triggerInstall);

  window.addEventListener('appinstalled', () => {
    console.log('[AnRu Teach] App successfully installed!');
    deferredPrompt = null;
    if (installBtn) installBtn.classList.add('hidden');
    if (quickInstallBtn) quickInstallBtn.classList.add('hidden');
  });

  // Register Service Worker immediately without waiting for window load event
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js', { scope: './' })
      .then((reg) => {
        console.log('[AnRu Teach] Service Worker registered. Scope:', reg.scope);
      })
      .catch((err) => {
        console.error('[AnRu Teach] Service Worker registration failed:', err);
      });
  }
}

// ============================================================================
// Application Bootstrapper
// ============================================================================
function initApp() {
  // 1. Initialize Slide Deck
  SlideManager.init();

  // 2. Initial Canvas Sizing
  CanvasEngine.resizeAndFit();

  // 3. Register Pointer & Touch Listeners with passive: false protection
  const canvas = DOM.drawCanvas;
  canvas.addEventListener('pointerdown', handlePointerDown);
  canvas.addEventListener('pointermove', handlePointerMove);
  canvas.addEventListener('pointerup', handlePointerUp);
  canvas.addEventListener('pointercancel', handlePointerUp);

  // Explicit touch events to guarantee complete touch gesture takeover
  canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  canvas.addEventListener('touchend', (e) => e.preventDefault(), { passive: false });

  // 4. Setup Toolbar & UI
  setupToolbarEvents();

  // 5. Handle Viewport Resizing (Orientation Change, Fullscreen, Virtual Keyboard)
  window.addEventListener('resize', () => {
    CanvasEngine.resizeAndFit();
    checkOrientation();
  });
  window.addEventListener('orientationchange', () => {
    setTimeout(() => {
      CanvasEngine.resizeAndFit();
      checkOrientation();
    }, 150);
  });

  // 6. Check Initial Orientation
  checkOrientation();

  // 7. Register PWA Service Worker
  setupPWAInstallation();

  // 8. Keyboard Shortcuts for Teachers (Arrow Left/Right for Slides, Ctrl+Z for Undo)
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'ArrowLeft') {
      SlideManager.goToSlide(state.currentSlideIndex - 1);
    } else if (e.key === 'ArrowRight') {
      SlideManager.goToSlide(state.currentSlideIndex + 1);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      if (e.shiftKey) {
        CanvasEngine.redo();
      } else {
        CanvasEngine.undo();
      }
    }
  });

  console.log('[AnRu Teach] Whiteboard & Slide Annotation Engine Ready.');
}

// Start App when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
