import {FRAME_TIME, GLOW_FILTER, mdebounce, setFields} from "./init.js";

// Keep the same size reduction for performance, might need tuning
const size_reduce = 1;

// Cache common values to avoid recalculation
const ZERO_ARRAY = [0, 0, 0, 0];
const MAX_INDEX = 0xFFFFFF;

// Re-use the same shader program, it's just for color encoding
const TOKEN_OCCLUDER_PROGRAM = new PIXI.Program(`
            attribute vec2 aVertexPosition;
            attribute vec2 aTextureCoord;
            uniform mat3 projectionMatrix;
            varying vec2 vTextureCoord;
            void main(void)
            {
                gl_Position = vec4((projectionMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
                vTextureCoord = aTextureCoord;
            }
`, `
                varying vec2 vTextureCoord;
                uniform sampler2D uSampler;
                uniform float delta;

                uniform float r;
                uniform float g;
                uniform float b;
                void main(void)
                {
                    vec4 color = texture2D(uSampler, vTextureCoord);
                    // Use alpha to determine hit, encode index in RGB
                    float nonZeroAlpha = step(0.01, color.a); // Faster than abs(sign(color.a))
                    gl_FragColor = vec4(r * nonZeroAlpha, g * nonZeroAlpha, b * nonZeroAlpha, nonZeroAlpha);
                }
`, "TOKEN_OCCLUDER");

// Create a shared filter for reuse (avoids constantly creating new filters)
const createColorFilter = (r, g, b) => {
    const filter = new PIXI.Filter(null, null, {r: r/255.0, g: g/255.0, b: b/255.0});
    filter.program = TOKEN_OCCLUDER_PROGRAM;
    return filter;
};

export class TokenSelector {
    //based on https://webglfundamentals.org/webgl/lessons/webgl-picking.html
    // Adapted from TileSelector for Tokens
    constructor() {
        this.renderer = canvas.app.renderer;
        
        // Use full resolution for better token detection across the entire scene
        this.scaleDown = 1.0; // Use 1.0 to ensure all tokens are properly detected
        this.renderTexture = PIXI.RenderTexture.create({
            width: Math.floor(canvas.dimensions.sceneWidth * this.scaleDown),
            height: Math.floor(canvas.dimensions.sceneHeight * this.scaleDown)
        });
        
        this.container = new PIXI.Container({name: "TokenSelector"});
        this.container.sortableChildren = true;
        this.indexer = new Map(); // Map from encoded index color -> token_id
        this.tokenToIndexer = new Map(); // Map from token_id -> [indexer_index, cloned_sprite]
        this.TOKEN_GLOW_FILTER = GLOW_FILTER; // Reuse or define a specific one if needed
        this.TOKEN_GLOW_FILTER.padding = 2; // Adjust padding if necessary
        
        // Cache for filters to avoid creating new ones
        this.filterCache = new Map();
        
        // Increase debounce time for better performance
        this.generateAlphaMaskIndex = mdebounce(() => this._generateAlphaMaskIndex(), Math.max(FRAME_TIME(), 50));
        this.current_token_index = null; // Store the raw index color under cursor

        // Store original interaction methods to restore them later
        this.originalInteraction = new Map();
        
        // Buffer for pixel reading - reuse instead of creating new ones
        this.pixelBuffer = new Uint8Array(4);
        
        // Temp point for coordinate transforms
        this.tempPoint = {x: 0, y: 0};
    }

    async init() {
        // Generate the index immediately
        this.generateAlphaMaskIndex();
        // No hooks here - they will be managed externally
    }

    destructor() {
        // No hooks to clean up

        // Restore original interaction for any remaining tokens
        for (const token of canvas.tokens.objects.children) {
             this.restoreTokenInteraction(token);
        }
        this.originalInteraction.clear();

        // Clear caches
        this.filterCache.clear();

        // Destroy PIXI objects
        this.container.destroy({children: true});
        this.renderTexture.destroy();
        this.indexer.clear();
        this.tokenToIndexer.clear();
        // Don't destroy the shared renderer
    }

    // Event handler methods are kept for external calls if needed
    handleTokenCreate(tokenDocument) {
        if (tokenDocument.rendered) {
            this.reindexToken(tokenDocument.id);
        }
    }

    handleTokenUpdate(tokenDocument, changes) {
        // Only reindex if position, rotation, scale, or visibility changed
        const relevantProps = ["x", "y", "rotation", "scale", "height", "width", "hidden"];
        const needsReindex = relevantProps.some(prop => changes[prop] !== undefined);
        
        if (needsReindex && tokenDocument.rendered) {
            this.reindexToken(tokenDocument.id);
        }
    }

    handleTokenDelete(tokenDocument) {
        this.deleteTokenFromIndex(tokenDocument.id);
    }

    deleteTokenFromIndex(token_id) {
        if (!this.tokenToIndexer.has(token_id)) return;
        
        let [indexer_index, cloned_sprite] = this.tokenToIndexer.get(token_id);
        cloned_sprite.destroy();
        this.indexer.delete(indexer_index);
        this.tokenToIndexer.delete(token_id);
        
        // Restore interaction for the deleted token in case it wasn't cleaned up properly
        const token = canvas.tokens.get(token_id);
        if (token) this.restoreTokenInteraction(token);
    }

    reindexToken(token_id) {
        // Get the token from canvas
        let token = canvas.tokens.get(token_id);
        
        // Fast path check - if token doesn't exist or lacks texture, return early
        if (!token || !token.mesh?.texture) return;
        
        let needsRender = false;
        
        // If token is not in index, add it
        if (!this.tokenToIndexer.has(token_id)) {
            // Add token to index with next available index
            this.#addTokenToIndex(token_id, this.indexer.size);
            needsRender = true;
        } 
        // Otherwise update the existing token in the index
        else {
            let [indexer_index, cloned_sprite] = this.tokenToIndexer.get(token_id);
            
            // Only update if the token is visible
            if (token.visible) {
                // Update the sprite properties from the token
                if (this.#copyTokenToSprite(cloned_sprite, token)) {
                    needsRender = true;
                }
            } else if (cloned_sprite.visible) {
                // If token became invisible, just update visibility
                cloned_sprite.visible = false;
                needsRender = true;
            }
        }
        
        // Only re-render if something changed
        if (needsRender) {
            this.#renderContainer();
        }
    }

    // A reusable method to render the container to the texture
    #renderContainer() {
        // Sort the container based on the token's sort property
        // Only sort if we have a significant number of tokens
        if (this.container.children.length > 1) {
            this.container.children.sort((a, b) => a.sort - b.sort);
        }

        // Render the container to the render texture
        this.renderer.render(this.container, {
            renderTexture: this.renderTexture,
            clear: true // Clear first to ensure clean rendering
        });
    }

    #copyTokenToSprite(sprite, token) {
        return setFields(sprite, token.mesh, ["width", "height", "position", "scale", "angle", "rotation", "skew", "pivot"]);
    }

    // Creates a sprite based on the token's mesh for the alpha mask index
    #cloneAlphaTokenSprite(token, r, g, b) {
        if (!token.mesh || !token.mesh.texture || token.mesh.destroyed) {
            console.warn(`Token ${token.id} has no valid mesh or texture, cannot clone for selector.`);
            return null; // Cannot clone if no mesh/texture
        }

        // Create a new sprite with the token's texture
        const sprite = new PIXI.Sprite(token.mesh.texture);
        
        // Copy essential properties from the token mesh
        sprite.anchor.copyFrom(token.mesh.anchor);
        
        // Copy all transform properties to ensure proper positioning in isometric view
        // This is similar to how TileSelector handles it
        setFields(sprite, token.mesh, ["width", "height", "position", "scale", "angle", "rotation", "skew", "pivot"]);
        
        // Reuse filters from cache
        const colorKey = `${r},${g},${b}`;
        
        if (!this.filterCache.has(colorKey)) {
            this.filterCache.set(colorKey, createColorFilter(r, g, b));
        }
        
        sprite.filters = [this.filterCache.get(colorKey)];
        
        // Set necessary properties for rendering
        sprite.blendMode = PIXI.BLEND_MODES.NORMAL;
        sprite.name = token.id; // Store token ID for debugging
        sprite.visible = token.visible; // Match token visibility
        sprite.sort = token.sort; // Preserve original sort order
        
        return sprite;
    }

    // Don't need _reindexToken anymore, as reindexToken handles both cases
    
    _generateAlphaMaskIndex() {
        let needsUpdate = false;
        
        // Batch operations - collect ids to remove first
        const currentTokenIds = new Set(canvas.tokens.objects.children.map(t => t.id));
        const indexedTokenIds = new Set(this.tokenToIndexer.keys());
        const tokensToDelete = [];
        
        // Identify tokens to remove (avoid modifying during iteration)
        for (const tokenId of indexedTokenIds) {
            const token = canvas.tokens.get(tokenId);
            if (!token || !currentTokenIds.has(tokenId)) {
                tokensToDelete.push(tokenId);
            }
        }
        
        // Remove tokens in batch
        if (tokensToDelete.length > 0) {
            for (const tokenId of tokensToDelete) {
                this.deleteTokenFromIndex(tokenId);
            }
            needsUpdate = true;
        }

        // Add new tokens in batch
        const tokensToAdd = [];
        
        // Collect tokens to add
        for (const token of canvas.tokens.objects.children) {
            if (!this.tokenToIndexer.has(token.id) && token.visible) {
                tokensToAdd.push(token);
            }
        }
        
        // Add tokens in batch
        if (tokensToAdd.length > 0) {
            let baseIndex = this.indexer.size;
            
            for (let i = 0; i < tokensToAdd.length; i++) {
                this.#addTokenToIndex(tokensToAdd[i].id, baseIndex + i);
            }
            needsUpdate = true;
        }

        if (needsUpdate) {
            this.#renderContainer();
        }
    }

    #addTokenToIndex(token_id, index) {
        const token = canvas.tokens.get(token_id);
        if (!token || !token.mesh?.texture || !token.visible) return; // Need a visible token with a texture

        try {
            // Encode index into RGB (up to 16,777,215 tokens)
            // Ensure index doesn't exceed max value
            index = index % MAX_INDEX; // Simple modulo wrap-around

            let r = (index >> 16) & 0xFF;
            let g = (index >> 8) & 0xFF;
            let b = index & 0xFF;

            let cloned_sprite = this.#cloneAlphaTokenSprite(token, r, g, b);
            if (!cloned_sprite) return; // Failed to clone (e.g., no texture)

            this.container.addChild(cloned_sprite);
            let indexer_index = (r << 16) | (g << 8) | b; // Reconstruct index color for map key
            this.indexer.set(indexer_index, token_id);
            this.tokenToIndexer.set(token_id, [indexer_index, cloned_sprite]);

            // Override interaction for this token
            this.overrideTokenInteraction(token);
        } catch (error) {
            console.error(`Failed to add token ${token_id} to index:`, error);
        }
    }

    // Reads the pixel color from the render texture at given texture coordinates
    #getRGBPixel(texX, texY) {
        // Ensure coordinates are within the scaled render texture
        texX = Math.round(texX * this.scaleDown);
        texY = Math.round(texY * this.scaleDown);

        // Ensure coordinates are within the bounds of the texture (fast bounds check)
        if (texX < 0 || texX >= this.renderTexture.width || texY < 0 || texY >= this.renderTexture.height) {
            return ZERO_ARRAY; // Use cached zero array
        }

        // Bind the render texture to read from it
        this.renderer.renderTexture.bind(this.renderTexture);
        const gl = this.renderer.gl;
        
        try {
            // Read the single pixel using the reused buffer
            gl.readPixels(texX, texY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.pixelBuffer);
            return this.pixelBuffer; // Return the reused buffer
        } catch (e) {
            console.error("Error reading pixel data from TokenSelector texture:", e);
            return ZERO_ARRAY; // Return cached zero array on error
        }
    }

    // Checks the pixel color at canvas coordinates and returns the corresponding token ID
    #getTokenIdAtPixel(canvasX, canvasY) {
        // Get pixel color at the transformed coordinates
        const pixels = this.#getRGBPixel(canvasX, canvasY);
        const [r, g, b, a] = pixels;

        // Fast check for transparency (alpha < 1)
        if (a < 1) {
            this.current_token_index = null;
            return null; // Hit transparent area
        }

        // Reconstruct the index from RGB
        this.current_token_index = (r << 16) | (g << 8) | b;
        return this.indexer.get(this.current_token_index) || null;
    }

    // Overrides the token's interaction handlers by hooking its hitArea
    overrideTokenInteraction(token) {
        if (!token?.hitArea) return; // No hitArea to override

        // Store original methods to restore later
        const originalContains = token.hitArea.contains;
        this.originalInteraction.set(token.id, { hitAreaContains: originalContains });

        // Override contains on the hitArea
        const $this = this; // Store reference for closure
        token.hitArea.id = token.id;
        token.hitArea.contains = function(lx, ly) { // x, y are likely local to the token's position
            // First, do a quick bounding box check using the mesh's dimensions
            let inBounds = false;
            
            // Get bounds - cache if possible
            let {x:bx,y:by,width:bw,height:bh} = token.mesh.getBounds();
            let {x:mx,y:my} = token.toGlobal(new PIXI.Point(lx, ly));

            // Fast bounds check
            if (mx >= bx && mx < bx + bw && my >= by && my < by + bh) {
                inBounds = true;
            }
            
            // If not in bounds, return false immediately
            if (!inBounds) {
                return false;
            }

            // Fast path for controlled tokens - skip expensive pixel check
            if (token.controlled) return true;
            
            // Using the reused temp point
            let glob = token.toGlobal(new PIXI.Point(lx, ly));
            canvas.stage.worldTransform.applyInverse(glob, $this.tempPoint);
            
            // Handle canvas stage scale
            // Check if the point is in any token by pixel color at the absolute position
            const tokenId = $this.#getTokenIdAtPixel($this.tempPoint.x, $this.tempPoint.y);

            // Fast comparison
            return this.id === tokenId;
        };
    }

    // Restores original interaction handlers for a token
    restoreTokenInteraction(token) {
        // Fast path - if no token or no entry in map, return immediately
        if (!token?.hitArea || !this.originalInteraction.has(token.id)) return;

        const originals = this.originalInteraction.get(token.id);
        if (originals.hitAreaContains) {
            token.hitArea.contains = originals.hitAreaContains;
        }

        this.originalInteraction.delete(token.id);
    }

    // Example hover effect (adapt as needed) - might need integration with Foundry's hover events
    tokenHover(token, hovered) {
        if (!token?.mesh) return;

        // Check if filters array exists before working with it
        if (!token.mesh.filters) token.mesh.filters = [];
        
        const hasGlow = token.mesh.filters.includes(this.TOKEN_GLOW_FILTER);

        // Only make changes if needed
        if (hovered && !hasGlow) {
            token.mesh.filters.push(this.TOKEN_GLOW_FILTER);
        } else if (!hovered && hasGlow) {
            token.mesh.filters = token.mesh.filters.filter(f => f !== this.TOKEN_GLOW_FILTER);
        }
    }

    // Optional: Add method for external query (e.g., for targeting)
    getTokenAt(x, y) {
        const tokenId = this.#getTokenIdAtPixel(x, y);
        return canvas.tokens.get(tokenId);
    }
}
