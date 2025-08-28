import {FRAME_TIME, GLOW_FILTER, mdebounce, setFields} from "./init.js";

const size_reduce = 4;
export class TileSelector {
    //based on https://webglfundamentals.org/webgl/lessons/webgl-picking.html
    constructor() {
        this.renderer = canvas.app.renderer;
        this.renderTexture = PIXI.RenderTexture.create({
            width: canvas.dimensions.width/size_reduce, height: canvas.dimensions.height/size_reduce
        });
        this.container = new PIXI.Container({name: "TileSelector"});
        this.container.sortableChildren = true;
        this.indexer = new Map();
        this.tileToIndexer = new Map();
        this.WALL_GLOW_FILTER = GLOW_FILTER;
        this.WALL_GLOW_FILTER.padding = 2;
        this.generateAlphaMaskIndex=mdebounce(()=>this._generateAlphaMaskIndex(),FRAME_TIME());
        this.current_tile = null;

    }

    async init(){
        // console.warn("INITED");
        // debugger;

        this.generateAlphaMaskIndex();
    }
    destructor() {
        // Clean up hooks
        Hooks.off("hoverTile");

        this.container.destroy()
        this.renderTexture.destroy()
        this.indexer = new Map();
        this.tileToIndexer = new Map();
        // this.renderer.destroy()

        // delete(this.container)
        // delete(this.renderTexture)
        // // delete(this.renderer)
    }

    deleteTileFromIndex(tile_id) {
        let [indexer_index, cloned_tile] = this.tileToIndexer.get(tile_id)
        cloned_tile.destroy()
        this.indexer.delete(indexer_index);
        this.tileToIndexer.delete(tile_id);

        this.generateAlphaMaskIndex();

    }

    reindexTile(tile_id) {
        // console.warn("reindexTile")
        if (!this.tileToIndexer.has(tile_id)) return;
        let [indexer_index, cloned_tile] = this.tileToIndexer.get(tile_id);
        let tile = canvas.primary.tiles.get(`Tile.${tile_id}`);
        // console.log(indexer_index, cloned_tile, tile);
        if (!tile) return;
        if (this.#copyTileToSprite(cloned_tile, tile)) {
            this.generateAlphaMaskIndex();
        }
    }

    #copyTileToSprite(sprite, tile) {
        let ret = setFields(sprite, tile, ["anchor", "width", "height", "position", "scale", "angle", "sort"])
        if (ret) {
            sprite.x = tile.x / size_reduce;
            sprite.y = tile.y / size_reduce;
            sprite.width = tile.width / size_reduce;
            sprite.height = tile.height / size_reduce;
        }
        return ret;

    }

    #cloneAlphaTileSprite(tile, r, g, b) {
        let sprite = PIXI.Sprite.from(tile.texture);
        sprite.sort = tile.sort;
        sprite.tint = 16777215;
        sprite.isSprite = true;
        sprite.blendMode = 0;
        sprite.name = tile.id;
        // sprite.drawMode = 4;
        sprite.visible = true;
        sprite.scale.set(0.1);
        this.#copyTileToSprite(sprite, tile);
        let filter = new PIXI.Filter(null, null, {r: r/256.0, g: g/256.0, b: b/256.0});
        // let filter = new PIXI.Filter(null, null, {r: r, g: g, b: b});
        filter.program = TILE_OCCLUDER_PROGRAM;
        sprite.filters = [filter];
        return sprite;
    }

    _generateAlphaMaskIndex() {
        // debounce
        canvas.tiles.objects.sortChildren();
        canvas.tiles.objects.children.forEach((t, i) => {
            if (t.visible && !t.destroyed && !this.tileToIndexer.has(t.document._id)) {
                this.#addTileToIndex(t.document._id, i);
            }
        })

        // Sort the container based on sort property
        this.container.children.sort((a, b) => {
            if (a.sort !== undefined && b.sort !== undefined) {
                return a.sort - b.sort;
            }
            return 0;
        });

        let renderTexture = this.renderTexture;

        this.renderer.render(this.container, {
            renderTexture
        });
    //
    // this.renderer.extract.base64(renderTexture).then(x => {
    //             console.warn(x)
    //         })
    }

    #addTileToIndex(tile_id, index) {
        let tile = canvas.primary.tiles.get(`Tile.${tile_id}`);
        if (tile === undefined) return;

           let r= (index & 0xff0000) >> 16;
            let g = (index & 0x00ff00) >> 8;
            let b= (index & 0x0000ff);
        let cloned_tile = this.#cloneAlphaTileSprite(tile, r, g, b);
        this.container.addChild(cloned_tile);
        let indexer_index =  (r << 16) + (g << 8) + (b);
        this.indexer.set(indexer_index, tile_id);
        this.tileToIndexer.set(tile_id, [indexer_index, cloned_tile]);
    }

    #getRGBPixel(renderer, renderTexture, x, y) {
        this.renderer.renderTexture.bind(this.renderTexture);
        const gl = this.renderer.gl;
        let webglPixels = new Uint8Array(4);
        gl.readPixels(Math.round(x), Math.round(y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, webglPixels);
        return webglPixels;
    }

    #testPixel(i_x, i_y) {
        let x = i_x / size_reduce;
        let y = i_y / size_reduce;
        const [r, g, b, a] = this.#getRGBPixel(this.renderer, this.renderTexture, x, y);
        
        if (a < 1) {
            this.current_tile = null;
            return null;
        }
        
        this.current_tile = (r << 16) + (g << 8) + b;
        let tile_id = this.indexer.get(this.current_tile);
        // console.log(tile_id);
        return tile_id || null;
    }

    tileContains(tile) {
        let $this = this;
        const hitArea = tile.frame.interaction.hitArea;
        if (!hitArea) return false;
        
        if (!hitArea._originalContains) {
            hitArea._originalContains = hitArea.contains;
        }
        
        hitArea.contains = function (x, y) {
            try {
                if (this.width <= 0 || this.height <= 0) {
                    return false;
                }
                if (x >= this.x && x < this.x + this.width) {
                    if (y >= this.y && y < this.y + this.height) {
                        if (tile.controlled) return true;
                        const tempPoint = {x: 0, y: 0}
                        let glob = tile.toGlobal(new PIXI.Point(x, y));
                        canvas.stage.worldTransform.applyInverse(glob, tempPoint);
                        return (tile.document._id === $this.#testPixel(tempPoint.x, tempPoint.y))
                    }
                }
                return false;
            } catch {
                return false
            }
        }
    }

    tileHover(tile, hovered) {
        if (!tile?.mesh) return;
        
        // Apply or remove glow filter based on hover state
        if (hovered) {
            tile.mesh.filters = [this.WALL_GLOW_FILTER];
        } else {
            tile.mesh.filters = [];
        }
    }

    // Add method to restore original behavior
    restoreTileControl(tile) {
        if (tile.hitAreaBackup) {
            tile._canControl = tile.hitAreaBackup;
            tile._canHover = tile._originalHover;
            tile.hitTest = tile._originalHitTest;
            delete tile.hitAreaBackup;
            delete tile._originalHover;
            delete tile._originalHitTest;
        }
    }

}

export const TILE_OCCLUDER_PROGRAM = new PIXI.Program(`
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
                    float nonZeroAlpha = abs(sign(color.a));
                    gl_FragColor = vec4(r * nonZeroAlpha, g * nonZeroAlpha, b * nonZeroAlpha, nonZeroAlpha);            
                }
`, "TILE_OCCLUDER");