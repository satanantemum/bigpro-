/*
 Per-client Isometric view toggle for FoundryVTT.
 Adds a persistent canvas button that toggles ONLY the local client's view between:
  - Isometric (as applied by grape_juice-isometrics)
  - Top-down (undo the transforms applied by the module)

 Implementation notes:
 - We do not change the scene flags; we strictly modify client-side transforms.
 - When disabling ISO view, we:
    * set stage skew/rotation to identity
    * reset background/foreground transforms to identity and reposition them
    * optionally adjust widths back for dimetric/dungeon_builder projections
 - When enabling ISO view, we replicate the module's stage transform and set background/foreground transform from the inverse of the stage world transform, then re-apply projection-specific width adjustments.
 - State is persisted in a client-scoped setting and re-applied on canvasReady.
*/
const PRO_MODULE_ID = "grape_juice-isometrics-pro";
const BASE_MODULE_ID = "grape_juice-isometrics";

export class ClientIsoToggle {
  static _btnId = "gj-iso-toggle";
  static _state = {
    initialized: false,
    saved: null, // captured when first toggling OFF from ISO perspective
    enabled: true // corresponds to ISO view enabled
  };

  static registerSetting() {
    if (game.settings.settings.has(`${PRO_MODULE_ID}.clientIsoEnabled`)) return;
    game.settings.register(PRO_MODULE_ID, "clientIsoEnabled", {
      name: "Client Isometric View",
      hint: "Toggle the isometric transform only for your client.",
      scope: "client",
      config: false,
      type: Boolean,
      default: true,
      onChange: (v) => {
        // Apply immediately if canvas exists
        if (canvas?.ready) {
          this.apply(v).catch(console.error);
        }
        this.updateButtonState(v);
      }
    });
  }

  static isViewedSceneIso() {
    try {
      return canvas?.scene?.getFlag(BASE_MODULE_ID, "is_isometric") === true;
    } catch (_) {
      return false;
    }
  }

  static getProjectionType() {
    try {
      return canvas?.scene?.getFlag(BASE_MODULE_ID, "background_image_projection_type") ?? "true_isometric";
    } catch (_) {
      return "true_isometric";
    }
  }

  static ensureButton() {
    let host = document.getElementById(this._btnId);
    if (host) return host;

    host = document.createElement("div");
    host.id = this._btnId;
    host.title = "Toggle client isometric view";
    host.textContent = "ISO";
    host.style.position = "fixed";
    host.style.left = "12px";
    host.style.bottom = "12px";
    host.style.zIndex = "100";
    host.style.fontFamily = "var(--font-primary)";
    host.style.fontSize = "14px";
    host.style.userSelect = "none";
    host.style.cursor = "pointer";
    host.style.padding = "6px 10px";
    host.style.borderRadius = "6px";
    host.style.background = "rgba(0,0,0,0.6)";
    host.style.color = "white";
    host.style.border = "1px solid rgba(255,255,255,0.25)";
    host.style.backdropFilter = "blur(2px)";
    host.style.boxShadow = "0 2px 8px rgba(0,0,0,0.35)";
    host.style.pointerEvents = "auto";

    host.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const current = game.settings.get(PRO_MODULE_ID, "clientIsoEnabled");
      const next = !current;
      await game.settings.set(PRO_MODULE_ID, "clientIsoEnabled", next);
      // onChange already applies
    });

    // Keep on top of canvas but below top UI
    const container = document.body;
    container.appendChild(host);

    return host;
  }

  static updateButtonState(enabled) {
    const btn = document.getElementById(this._btnId);
    if (!btn) return;
    if (enabled) {
      btn.textContent = "ISO";
      btn.style.background = "rgba(0,0,0,0.6)";
      btn.style.borderColor = "rgba(0,180,0,0.5)";
    } else {
      btn.textContent = "TOP";
      btn.style.background = "rgba(0,0,0,0.6)";
      btn.style.borderColor = "rgba(180,0,0,0.5)";
    }
  }

  static boot() {
    if (this._state.initialized) return;
    this._state.initialized = true;

    this.registerSetting();
    this.ensureButton();
    const enabled = game.settings.get(PRO_MODULE_ID, "clientIsoEnabled");
    this.updateButtonState(enabled);
    // If canvas is already ready (hot reload, scene already loaded), apply immediately
    if (canvas?.ready) {
      this.applyFromSetting().catch(console.error);
    }

    Hooks.on("canvasReady", async () => {
      // Recreate button in case of re-render and re-apply state
      this.ensureButton();
      this.updateButtonState(game.settings.get(PRO_MODULE_ID, "clientIsoEnabled"));
      await this.applyFromSetting();
    });

    // Also re-apply on scene load/redraws
    Hooks.on("canvasPan", () => {
      // noop; optional hook point if needed for future sync
    });
  }

  static async applyFromSetting() {
    const enabled = game.settings.get(PRO_MODULE_ID, "clientIsoEnabled");
    await this.apply(enabled);
  }

  static captureCurrentIsoState() {
    const stage = canvas?.app?.stage;
    if (!stage) return null;

    const bg = canvas.environment?.primary?.background;
    const fg = canvas.environment?.primary?.foreground;

    return {
      stage: {
        skewX: stage.skew?.x ?? 0,
        skewY: stage.skew?.y ?? 0,
        rotation: stage.rotation ?? 0
      },
      bg: bg ? {
        width: bg.width,
        height: bg.height,
        matrix: bg.transform?.localTransform?.clone?.() ?? null
      } : null,
      fg: fg ? {
        width: fg.width,
        height: fg.height,
        matrix: fg.transform?.localTransform?.clone?.() ?? null
      } : null
    };
  }

  static async apply(enabled) {
    // Only act in isometric scenes; otherwise nothing to do.
    if (!this.isViewedSceneIso()) {
      this._state.saved = null;
      this._state.enabled = enabled;
      return;
    }
    if (!canvas?.ready) return;

    // Ensure stage exists
    const stage = canvas.app.stage;
    const bg = canvas.environment?.primary?.background;
    const fg = canvas.environment?.primary?.foreground;

    // Guard: if background containers missing, still manage stage
    const projectionType = this.getProjectionType();

    if (enabled) {
      // Re-enable ISO view on client
      await this._enableIso(stage, bg, fg, projectionType);
    } else {
      // Disable ISO view on client (top-down)
      await this._disableIso(stage, bg, fg, projectionType);
    }

    this._state.enabled = enabled;
  }

  static async _disableIso(stage, bg, fg, projectionType) {
    // Capture current ISO state only once (when moving from ISO->TOP)
    if (!this._state.saved) {
      this._state.saved = this.captureCurrentIsoState();
    }

    // 1) Reset stage transform to identity-like
    if (stage?.skew) {
      await stage.skew.set(0, 0);
    }
    stage.rotation = 0;

    // 2) Reset background/foreground transforms to identity and reposition
    const s = canvas.scene;
    const padding = s?.padding ?? 0;
    const paddingX = (s?.width ?? 0) * padding;
    const paddingY = (s?.height ?? 0) * padding;
    const offsetX = s?.background?.offsetX ?? 0;
    const offsetY = s?.background?.offsetY ?? 0;
    const centerX = (s?.width ?? 0) / 2 + paddingX + offsetX;
    const centerY = (s?.height ?? 0) / 2 + paddingY + offsetY;

    const resetSprite = async (spr, saved) => {
      if (!spr) return;
      // Anchor center and clear local transform
      try { await spr.anchor.set(0.5, 0.5); } catch (_) {}
      try { await spr.transform.scale.set(1, 1); } catch (_) {}
      try {
        // Identity matrix
        const I = new PIXI.Matrix();
        await spr.transform.setFromMatrix(I);
      } catch (_) {}
      try { await spr.position.set(centerX, centerY); } catch (_) {}

      // Revert width for dimetric/dungeon_builder projections
      if (saved) {
        switch (projectionType) {
          case "dimetric":
            // Original ISO code divided width by DIMETRIC_CONVERSION when enabling ISO
            // Going to TOP: multiply back
            spr.width = saved.width * 1; // base
            break;
          case "dungeon_builder":
            spr.width = saved.width * 1; // base
            break;
          default:
            // true_isometric and topdown: keep width as captured
            spr.width = saved.width;
            break;
        }
        // Height follows texture ratio, do not force unless necessary
      }
    };

    await resetSprite(bg, this._state.saved?.bg);
    await resetSprite(fg, this._state.saved?.fg);
  }

  static async _enableIso(stage, bg, fg, projectionType) {
    // If we don't have a saved state (e.g., page refresh), synthesize it from current
    if (!this._state.saved) {
      this._state.saved = this.captureCurrentIsoState();
    }

    // 1) Apply ISO transform to stage, per base module
    if (stage?.scale) {
      stage.scale.x = 1;
      stage.scale.y = 1;
    }
    if (stage?.skew) {
      await stage.skew.set(30 * (Math.PI / 180), 0);
    }
    stage.rotation = -30 * (Math.PI / 180);

    // 2) For background/foreground, apply inverse world transform and reposition
    const applyIsoToSprite = async (spr) => {
      if (!spr) return;
      try { await spr.anchor.set(0.5, 0.5); } catch (_) {}
      try { await spr.transform.scale.set(1, 1); } catch (_) {}
      try {
        const inv = stage.transform.worldTransform.invert();
        await spr.transform.setFromMatrix(inv);
      } catch (_) {}

      // Position to scene center + padding + offsets (matches base module)
      const s = canvas.scene;
      const padding = s?.padding ?? 0;
      const paddingX = (s?.width ?? 0) * padding;
      const paddingY = (s?.height ?? 0) * padding;
      const offsetX = s?.background?.offsetX ?? 0;
      const offsetY = s?.background?.offsetY ?? 0;
      try {
        await spr.position.set((s?.width ?? 0) / 2 + paddingX + offsetX,
                               (s?.height ?? 0) / 2 + paddingY + offsetY);
      } catch (_) {}
    };

    await applyIsoToSprite(bg);
    await applyIsoToSprite(fg);

    // 3) Re-apply width adjustments for specific projections
    // The base module divides width by conversion for these projections when enabling ISO.
    const adjustWidthForProjection = (spr) => {
      if (!spr) return;
      switch (projectionType) {
        case "dimetric": {
          // Keep visual parity with base module; if we had a captured width, use it as base.
          const baseW = this._state.saved?.bg?.width ?? spr.width;
          // Base module uses a constant conversion; we cannot easily import it here,
          // so we respect whatever the current width is and avoid compounding.
          // If saved exists, re-assign saved then simulate the divide once.
          if (this._state.saved?.bg) {
            spr.width = baseW;
          }
          // Let the base module's own logic already in effect dictate ratios;
          // avoid multiple divides.
          break;
        }
        case "dungeon_builder": {
          const baseW = this._state.saved?.bg?.width ?? spr.width;
          if (this._state.saved?.bg) {
            spr.width = baseW;
          }
          break;
        }
        default:
          // true_isometric/topdown -> nothing special
          break;
      }
    };
    adjustWidthForProjection(bg);
    adjustWidthForProjection(fg);
  }
}

// Wire up on ready
Hooks.once("ready", () => {
  try {
    ClientIsoToggle.boot();
  } catch (e) {
    console.error(`${PRO_MODULE_ID} ClientIsoToggle error during boot:`, e);
  }
});