import {FRAME_TIME, getBoolFlag, getValueFlag, mdebounce, setFields} from "./init.js";
import {outline_occlusion_shader} from "../shaders/token_occluder/outline_occlusion_shader.frag.js";

// maybe for each light source i can add
//
// to it's canvas.app.renderer.extract.base64(a.uniforms.uSampler)
//
// the tile, or remove it? i need to figure out how it's generated though,
//
// and it should affect only when alpha changes
// should calculate if it's over or under, and decide if to paint a white tile on it or no....
// maybe there is a better way, need to look for more details
//


export function norm(value, min, max) {
    return (value - min) / (max - min);
}

const size_reduce = 4;

export class TokenOccluder {
    constructor() {
        this.renderer = canvas.app.renderer;
        this.renderTexture = PIXI.RenderTexture.create({
            width: canvas.dimensions.width/size_reduce, height: canvas.dimensions.height/size_reduce
        });
        this.container = new PIXI.Container();
        this.container.sortableChildren = true;
        this.indexer = new Map();
        this.tileToIndexer = new Map();
        this.renderTextureSprite = null;
        this.boundsMap = new Map();
        // this.generateAlphaMaskIndex = mdebounce(() => this._generateAlphaMaskIndex(), FRAME_TIME());
        this.generateAlphaMaskIndex = this._generateAlphaMaskIndex;

    }

    async init() {
        this.generateAlphaMaskIndex();
    }

    destructor() {
        this.container.destroy()
        this.renderTexture.destroy()
        this.indexer = new Map();
        this.tileToIndexer = new Map();
        this.boundsMap = new Map();
        // delete(this.container);
        // delete(this.renderTexture);
        // this.unload_filters()
    }

    unload_filters() {
        canvas.tokens.objects.children.forEach(token=>{
            let index = token.mesh.filters.findIndex(x => typeof x.getName === "function" && x.getName() === "TextureMaskFilter");
            if (index>=0){
                token.mesh.filters[index]=null;
            }

        })
    }



    deleteTileFromIndex(tile_id) {
        let ret = this.tileToIndexer.get(tile_id);
        if (!ret) return;
        let [indexer_index, cloned_tile] = ret;
        cloned_tile.destroy()
        this.indexer.delete(indexer_index);
        this.tileToIndexer.delete(tile_id);

        this.generateAlphaMaskIndex();

    }

    reindexTile(tile_id, visibleTiles) {
        // this works wrong,
        // first this can fail if a tile didn't have the mask flag
        // second, we need to check if the "bounds" of the tile changed
        // meaning it's geometry changed, and also consider Z-index maybe
        // if it did, we need to re-paint the tile's anchor point into the sprite
        // same goes if the position changed, so i guess if any of the bounds/position
        // is different, the tile needs to be repainted with that info, and then updated
        // and have the renderTexture redrawn.
        // maybe for visible invisible tiles, we can simplify the loop, by just
        // hooking it's visibility status in the sight testing, into this
        // so no need to loop it.

        // same goes for delete
        if (!this.tileToIndexer.has(tile_id)) return;

        let [indexer_index, cloned_tile] = this.tileToIndexer.get(tile_id);
        let tile = canvas.primary.tiles.get(`Tile.${tile_id}`);
        if (!tile) return;

        //todo: update the calculated xy point, figure out why when it loads the points are all wrong.
        if (this.#copyTileToSprite(cloned_tile, tile)) this.generateAlphaMaskIndex();
    }

    #copyTileToSprite(sprite, tile) {
        const changed = setFields(sprite, tile, ["anchor", "width", "height", "position", "scale", "angle", "zIndex"]);

        if (changed) {
            sprite.x = tile.x / size_reduce;
            sprite.y = tile.y / size_reduce;
            sprite.width = tile.width / size_reduce;
            sprite.height = tile.height / size_reduce;

            let bounds = this.#getBounds(sprite, tile);
            if (!bounds) return;
            const x = (sprite.position.x) + bounds.left - (bounds.width / 2);
            const y = (sprite.position.y) + (bounds.height / 2) - (bounds.height - bounds.bottom);


            let normalized_x = norm(x, canvas.dimensions.width/size_reduce, 0)
            normalized_x = ((0xff * normalized_x) & 255) / 255;

            let normalized_y = norm(y, 0, canvas.dimensions.height/size_reduce)
            normalized_y = ((0xff * normalized_y) & 255) / 255;


            sprite.meta = {
                x: x, y: y, nx: normalized_x, ny: normalized_y
            }
            let filter = new PIXI.Filter(null, `
                varying vec2 vTextureCoord;
                uniform sampler2D uSampler;
                uniform float x;
                uniform float y;

                void main(void)
                {
                    mediump vec4 color = texture2D(uSampler, vTextureCoord);
                    color.a =floor(0.5+color.a);
                   gl_FragColor = vec4(color.a, x*color.a, y*color.a ,color.a);
                }
        `, {x: normalized_x, y: normalized_y});

            sprite.filters = [filter]
        }
        return changed;
    }

    #boundsKey(sprite) {
        return `K.${sprite.anchor}.${sprite.width}.${sprite.height}.${sprite.scale}.${sprite.angle}.${sprite.texture.baseTexture.uid}`
    }

    //
    #checkRow(data, width, y) {
        for (let x = 0, index = 4 * y * width; x < width; ++x, index += 4) {
            if (data[index + 3] > 255 / 2) return false;
        }
        return true;
    }

    #checkColumn(data, width, x, top, bottom) {
        const stride = 4 * width;
        for (let y = top, index = (top * stride) + (4 * x); y <= bottom; ++y, index += stride) {
            if (data[index + 3] > 255 / 2) return false;
        }
        return true;
    }

    #rowSearch(data, width, height) {
        const getPixelAlpha = function (data, x, y, width) {
            let stride = width * 4;
            let _x = (4 * x) + 3;
            let _y = stride * y;
            return data[_x + _y];
        }


        for (let y = 0; y < height; y++) { //col
            for (let x = 0; x < width; x++) { //row
                if (getPixelAlpha(data, x, y, width) !== 0) {
                    break;
                }
            }
        }
    }


    #calculateBounds(sprite, tile) {
        sprite.calculateBounds();
        let {width, height} = sprite.getBounds()
        const size = Math.max(Math.ceil(width), Math.ceil(height));
        let {x: x_scale, y: y_scale} = canvas.primary.transform.scale;

        width = Math.ceil(size);
        height = Math.ceil(size);

        const renderTexture = PIXI.RenderTexture.create({width, height});
        let {x: pos_x, y: pos_y} = sprite.position;
        let {x: anchor_x, y: anchor_y} = sprite.anchor;
        sprite.anchor.set(0.5, 0.5);
        sprite.position.set(width / 2, height / 2);
        this.renderer.render(sprite, {renderTexture})
        const pixels = this.renderer.extract.pixels(renderTexture);
        renderTexture.destroy(false);
        sprite.position.set(pos_x, pos_y);
        sprite.anchor.set(anchor_x, anchor_y);

        let left = 0;
        let top = 0;
        let right = width - 1;
        let bottom = height - 1;
        while (top < height && this.#checkRow(pixels, width, top)) ++top;
        if (top === height) return undefined;
        while (this.#checkRow(pixels, width, bottom)) --bottom;
        while (this.#checkColumn(pixels, width, left, top, bottom)) ++left;
        while (this.#checkColumn(pixels, width, right, top, bottom)) --right;
        ++right;
        ++bottom;

        return {left, top, right, bottom, width, height};
    }

    #getBounds(sprite, tile) {

        return this.#calculateBounds(sprite, tile);
//this is the bug?!

        let key = this.#boundsKey(sprite);
        let bounds = this.boundsMap.get(key);
        if (bounds === undefined) {
            bounds = this.#calculateBounds(sprite, tile);
            this.boundsMap.set(key, bounds);
        }
        return bounds;
    }

    #cloneAlphaTileSprite(tile) {
        // tile.texture.baseTexture.alphaMode = PIXI.ALPHA_MODES.NPM;

        let sprite = PIXI.Sprite.from(tile.texture);
        // sprite.tint = 16777215;
        sprite.isSprite = true;
        // sprite.blendMode = 13;
        sprite.name = tile.documentId || tile.id;
        // sprite.drawMode = 4;

        // let z = (tile.x + (tile.width * 0.5)) - (tile.y + (tile.height * 0.5));
        // let max = canvas.dimensions.width;
        // let min = -canvas.dimensions.height;


        this.#copyTileToSprite(sprite, tile);


        return sprite;
    }

    /*
       // avoid alpha shenanigans for base64 export
        PIXI.Extract.arrayPostDivide = function(e, t) {
            for (var r = 0; r < e.length; r += 4) {
                var n = t[r + 3] = e[r + 3];
                t[r] = e[r];
                t[r + 1] = e[r + 1];
                t[r + 2] = e[r + 2];
            }
        }
    */

    _generateAlphaMaskIndex() {
        canvas.tiles.objects.children.filter(x => getBoolFlag(x.document || x, 'is_tile_occluder')).sort().forEach((t, i) => {
            if (!this.tileToIndexer.has(t.documentId || t.id || t._id)) {
                this.#addTileToIndex(t.documentId || t.id || t._id, i);
            }
        });

        let renderTexture = this.renderTexture;
        this.renderer.render(this.container, {
            renderTexture
        });

        // this.renderer.extract.base64(renderTexture).then(x => {
        //     console.warn(x)
        // })


    }

    #testPixelRBG(x, y) {
        const webglPixels = new Uint8Array(4);
        const gl = this.renderer.gl;
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, webglPixels);
        return webglPixels;
    }

    #addTileToIndex(tile_id, index) {
        let tile = canvas.primary.tiles.get(`Tile.${tile_id}`);
        if (tile === undefined) return;

        let cloned_tile = this.#cloneAlphaTileSprite(tile);
        this.container.addChild(cloned_tile);
        this.tileToIndexer.set(tile_id, [null, cloned_tile]);
        return [null, cloned_tile];
    }

    updateTileVisibility(tile_id, visible) {
        let ret = this.tileToIndexer.get(tile_id) || this.#addTileToIndex(tile_id);
        if (ret) {
            let [indexer_index, cloned_tile] = ret;
            cloned_tile.alpha = visible ? 1 : 0;
        }
    }

    getSpriteMask() {
        // console.error(this.renderer.extract.base64(this.renderTexture));
        // debugger;

        return this.renderTexture;

    }


    calculatePosition(token) {

        let {x, y} = token.center;
        x/=  size_reduce;
        y/=  size_reduce;

        if (game.settings.get('grape_juice-isometrics', 'enable_token_occluder_elevation')){
            x-=(token.document.elevation / canvas.scene.grid.distance) * canvas.grid.size
            y+=(token.document.elevation / canvas.scene.grid.distance) * canvas.grid.size
        }

        // let x = token.x + ((canvas.grid.size / 2) * token.document.width);
        x = norm(x, canvas.dimensions.width/size_reduce, 0)
        x = ((0xff * x) & 255) / 255;

        // let y = token.y + ((canvas.grid.size / 2) * token.document.height);
        y = norm(y, 0, canvas.dimensions.height/size_reduce)
        y = ((0xff * y) & 255) / 255;
        return {x, y}
    }

    refreshToken(_token, skip_visible = false) {


        let token = _token?.mesh ? _token : canvas.tokens.get(_token.id);
        // let token = _token?.mesh || _token;

        // if ((skip_visible == false) || token?.mesh === undefined) return;
        if (((token.visible == false) && skip_visible == false) || token?.mesh === undefined) return;
        // if (((token.visible == false && !token.center )&& skip_visible == false) || token?.mesh === undefined) return;
        // if (token?.mesh === undefined) return;

        let {x, y} = this.calculatePosition(token);
        let enable_outline = getBoolFlag(token.document, "enable_token_occluder_outline", true);
        let outline_color = getValueFlag(token.document, "token_occluder_outline_color", "#c3fe20");
        let fill_color =getBoolFlag(token.document, "enable_token_occluder_fill", true) ? getValueFlag(token.document, "token_occluder_fill_color", "#6a5858") : "#000000";
        let fill_color_alpha = getBoolFlag(token.document, "enable_token_occluder_fill", true) ? getValueFlag(token.document, "token_occluder_fill_alpha", 1.0) : 0.0;


        if (token.mesh.filters === null) {
            token.mesh.filters = [];
        }
        let occ_idx = token.mesh.filters.findIndex(x => typeof x.getName === "function" && x.getName() === "TextureMaskFilter");
        let lastIndex = token.mesh.filters.length - 1; // Get the last index of the filters array

        switch (occ_idx) {
            case -1: // No existing TextureMaskFilter found
                const renderTexture = this.getSpriteMask();
                const textureMask = new TextureMaskFilter(renderTexture, token.document.disposition, x, y, enable_outline, outline_color, fill_color, fill_color_alpha);
                token.mesh.filters.push(textureMask); // Add new filter to the end
                break;
            case lastIndex: // The existing TextureMaskFilter is already the last element
                // Directly update uniforms without moving the filter
                token.mesh.filters[occ_idx].updateUniforms(token.document.disposition, x, y, enable_outline, outline_color, fill_color, fill_color_alpha);
                break;
            default: // Existing TextureMaskFilter found but not the last element
                // Move the existing filter to the end
                const [existingFilter] = token.mesh.filters.splice(occ_idx, 1);
                token.mesh.filters.push(existingFilter);
                // Update uniforms of the filter now at the end
                token.mesh.filters[lastIndex].updateUniforms(token.document.disposition, x, y, enable_outline, outline_color, fill_color, fill_color_alpha);
                break;
        }
    }

}


export const fragment = `varying vec2 vMaskCoord;
varying vec2 vTextureCoord;

uniform sampler2D uSampler;
uniform sampler2D mask;
uniform float alpha;
uniform float npmAlpha;
uniform vec4 maskClamp;

void main(void)
{
    float clip = step(3.5,
        step(maskClamp.x, vMaskCoord.x) +
        step(maskClamp.y, vMaskCoord.y) +
        step(vMaskCoord.x, maskClamp.z) +
        step(vMaskCoord.y, maskClamp.w));

    vec4 original = texture2D(uSampler, vTextureCoord);
    vec4 masky = texture2D(mask, vMaskCoord);
    float alphaMul = 1.0 - npmAlpha * (1.0 - masky.a);

    original *= (alphaMul * masky.r * alpha * clip);

    gl_FragColor = original;
}`

export const fragment3 = `varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform sampler2D mask;
varying vec2 vMaskCoord;
uniform mat4 colorMatrix;

void main(void)
{
    vec4 color = texture2D(uSampler, vTextureCoord)* colorMatrix;
    vec4 mask = texture2D(mask, vMaskCoord);
    if (mask.a != 0.0){
        // color.r = color2.r;
        // color.g = color2.g;
        // color.b = color2.b;
        //color.a = 0.0;
        // color = mix(color, vec4(1.0) - color, 1);
        // color = color * Color;
        // color = color * colorMatrix;
    }
    gl_FragColor = color;
}
`
export const fragment3aa = `varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform sampler2D mask;
varying vec2 vMaskCoord;
uniform mat4 colorMatrix;
 uniform float z;

void main(void)
{
    vec4 color = texture2D(uSampler, vTextureCoord);
    vec4 mask = texture2D(mask, vMaskCoord);
    if (mask.a > 0.5 && mask.r < z){
        // color.r = color2.r;
        // color.g = color2.g;
        // color.b = color2.b;
        //color.a = 0.0;
        // color = mix(color, vec4(1.0) - color, 1);
        // color = color * Color;
        // color = color * colorMatrix;
    }
    else{
        gl_FragColor = color;
    }
}
`
export const fragment2 = `
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform sampler2D mask;
varying vec2 vMaskCoord;
uniform float m[20];

void main(void)
{
    vec4 color = texture2D(uSampler, vTextureCoord);
    vec4 mask = texture2D(mask, vMaskCoord);
    if (mask.a != 0.0){
        // color.r = color2.r;
        // color.g = color2.g;
        // color.b = color2.b;
        //color.a = 0.0;
        // color = mix(color, vec4(1.0) - color, 1);
        // color = color * Color;
        // color = color * colorMatrix;
        vec4 c = color;
        if (c.a > 0.0) {
        c.rgb /= c.a;
    }
    vec4 result;
    result.r = (m[0] * c.r);
    result.r += (m[1] * c.g);
    result.r += (m[2] * c.b);
    result.r += (m[3] * c.a);
    result.r += m[4];
    result.g = (m[5] * c.r);
    result.g += (m[6] * c.g);
    result.g += (m[7] * c.b);
    result.g += (m[8] * c.a);
    result.g += m[9];
    result.b = (m[10] * c.r);
    result.b += (m[11] * c.g);
    result.b += (m[12] * c.b);
    result.b += (m[13] * c.a);
    result.b += m[14];
    result.a = (m[15] * c.r);
    result.a += (m[16] * c.g);
    result.a += (m[17] * c.b);
    result.a += (m[18] * c.a);
    result.a += m[19];
    vec3 rgb = mix(c.rgb, result.rgb, 1.5);
    rgb *= result.a;
    gl_FragColor = vec4(rgb, result.a);
    }
    else{
        gl_FragColor = color;
    }
}
`
export const fragment222 = `varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform sampler2D mask;
varying vec2 vMaskCoord;
uniform float m[20];

void main(void)
{
    vec4 color = texture2D(uSampler, vTextureCoord);
    vec4 mask = texture2D(mask, vMaskCoord);
    if ((mask.a != 0.0) && color.a != 0.0){
        // color.r = color.r*10.0;
        // color.g = color2.g;
        // color.b = color2.b;
        // color.a = 0.0;
        // color = mix(color, vec4(1.0) - color, 1);
        // color = color * Color;
        // color = color * colorMatrix;
        
        vec4 COLOR = vec4(1.0,1.0,1.0,1.0);
        COLOR.rgb = vec3(1.0,0.0,0.0);

        vec2 size = vec2(1.0) /vec2(100.0,100.0);
        float alpha = color.a;
        alpha += texture2D(uSampler, vTextureCoord + vec2(0.0, -size.y)).a;
        alpha += texture2D(uSampler, vTextureCoord + vec2(size.x, -size.y)).a;
        alpha += texture2D(uSampler, vTextureCoord + vec2(size.x, 0.0)).a;
        alpha += texture2D(uSampler, vTextureCoord + vec2(size.x, size.y)).a;
        alpha += texture2D(uSampler, vTextureCoord + vec2(0.0, size.y)).a;
        alpha += texture2D(uSampler, vTextureCoord + vec2(-size.x, size.y)).a;
        alpha += texture2D(uSampler, vTextureCoord + vec2(-size.x, 0.0)).a;
        alpha += texture2D(uSampler, vTextureCoord + vec2(-size.x, -size.y)).a;
        if (alpha >= 9.0) {
            alpha = 0.0;
        }
        COLOR = vec4(mask.rgb, min(alpha, 1.0) * color.a);
            gl_FragColor = COLOR;
    }
    else{
        gl_FragColor = color;
    }
}
`
export const fragment2441 = `varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform sampler2D mask;
varying vec2 vMaskCoord;


void main(void)
{
    vec4 color = texture2D(uSampler, vTextureCoord);
    vec4 mask = texture2D(mask, vMaskCoord);
    color.a = color.a * (1.0-(mask.a));
    //  color.a = color.a * mask.a;
    gl_FragColor = color; 
   
}
`
export const fragment244 = `varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform sampler2D mask;
varying vec2 vMaskCoord;


void main(void)
{
    vec4 color = texture2D(uSampler, vTextureCoord);
    vec4 mask = texture2D(mask, vMaskCoord);
    vec3 glow = vec3(0.5176470588235295, 0.8, 1.0);
    float intensity = 0.5;
    // mask.g = 1.0;
    // color.a = color.a * (1.0-(mask.a));
    //  color.a = color.a * mask.a;
    //  color = color * (mask* (1.0-(mask.a)));
    if (mask.a != 0.0){
    // color.a = color.a / 2.0;
    
    // color.a = color.a * 0.4;
    
    color.g = color.g  * 0.8901960784313725;
    color.r = 0.0;
    color.b = 0.0;//color.b  * 0.5372549019607843;
    // color.rgb = pow(color.rgb, vec3(1.0/1.2));
    float old = color.a;
    color = vec4( color.rgb * intensity, intensity );
    color.a = old;
    
    }
    gl_FragColor = color; 
   
}
`
export const fragment22 = `varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform sampler2D mask;
varying vec2 vMaskCoord;
uniform mat4 colorMatrix;
void main(void)
{
    vec4 color = texture2D(uSampler, vTextureCoord)* colorMatrix;
    vec4 mask = texture2D(mask, vMaskCoord);
    if (mask.a != 0.0){

        
    }
    gl_FragColor = color;
}
`


export const fragment33 = `
            

varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform sampler2D mask;
varying vec2 vMaskCoord;



varying vec4 vColor;


uniform float outerStrength;
uniform float innerStrength;

uniform vec4 glowColor;

uniform vec4 filterArea;
uniform vec4 filterClamp;
uniform bool knockout;

const float PI = 3.14159265358979323846264;

const float DIST = 8.0;
const float ANGLE_STEP_SIZE = min(1.2500000, PI * 2.0);
const float ANGLE_STEP_NUM = ceil(PI * 2.0 / ANGLE_STEP_SIZE);

const float MAX_TOTAL_ALPHA = ANGLE_STEP_NUM * DIST * (DIST + 1.0) / 2.0;
 uniform float z;
                uniform float x;
                uniform float y;

void main(void) {
    vec4 color = texture2D(uSampler, vTextureCoord);
    vec4 mask = texture2D(mask, vMaskCoord);//
        // color*=mask.a;
//      if (((mask.b) >= y && (mask.g) <= x)|| (mask.b >= y*color.a && mask.g <= x*color.a)){
//     color.rgb /= color.a;
//
//      color.a = (mask.a);
//     color.rgb *= color.a;
//
//      gl_FragColor = color;
//     } else{
// gl_FragColor = color;
//
//     }
//     float alpha = clamp(mask.a, 0.0,1.0);
//     color.a = clamp(color.a, 0.0,1.0);
//     color.rgb /= color.a;
//     //     // color.rgb /= alpha;
//     // 
//      color.a = 1.0-min(alpha,color.a);
//     color.rgb *= color.a;
//     gl_FragColor = color;
//     mask.rgb/=mask.a;
 float a = (mask.a);
     // if (((1.0-mask.a)) > 0.0)
     // {
     // // ;
     // mask.a = 1.0;
     // }
      // if  (mask.b >= y && mask.g <= x){
      // if  (mask.b >= y && mask.g <= x ) {
      if  (mask.r*a != 0.0 ) {
         // float alpha = (1.0-(mask.a));
         // //
         // color.rgb /=  color.a;
         // color.a = clamp(min(color.a,alpha),0.0,1.0);
         // color.rgb *=  color.a;
         }
     else{
      gl_FragColor = color;
     }

    // float a =  (mask.r*mask.a);
    if  ((mask.b >= y &&  mask.g >= x) ){
        // color.a= min(1.0 - mask.r,color.a);
        // color.rgb*=color.a;
        //         mask.r=(mask.r*mask.r*mask.r);//(*mask.r);
        // color.a= min(1.0-mask.r,color.a);
        // color.rgb*=color.a;
        // if  (!(mask.b*mask.a >= y &&  mask.g*mask.a >= x)){
        // color.a= (1.0-mask.a);
        // }else{
        //
        //   color.a= min(1.0-mask.a,color.a);
        //   }
        
        
        // this
           color.a=1.0-mask.a;// min(1.0-mask.a,color.a);

           color.rgb*=color.a;
         
    }
    // // if (mask.a < 1.0){
    //  color.a=mask.a;//=min(mask.a,color.a);
    //      
    //        color.rgb*=color.a;
    // // }
    //          //   mask.r=(mask.r*mask.r*mask.r);//(*mask.r);
    //         
    //
    //     color.rgb/=color.a;

    gl_FragColor = color;
}
`
export const vertex = `attribute vec2 aVertexPosition;
attribute vec2 aTextureCoord;

uniform mat3 projectionMatrix;
uniform mat3 otherMatrix;

varying vec2 vMaskCoord;
varying vec2 vTextureCoord;

void main(void)
{
    gl_Position = vec4((projectionMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);

    vTextureCoord = aTextureCoord;
    vMaskCoord = ( otherMatrix * vec3( aTextureCoord, 1.0)  ).xy;
}`


export class TextureMaskFilter extends PIXI.Filter {

    maskMatrix;
    maskTexture;

    /** @ignore */
    constructor(texture, disposition, x, y, enable_outline, outline_color, fill_color, fill_alpha) {
        // super(vertex, fragment3aa, undefined);
        // super(vertex, fragment33, undefined);
        super(vertex, outline_occlusion_shader, undefined);

        // if (outline_color){
        //     this.uniforms.glowColor = new Float32Array(PIXI.utils.hex2rgb(PIXI.utils.string2hex(outline_color)));
        //     this.uniforms.fill_color =  new Float32Array([...PIXI.utils.hex2rgb(PIXI.utils.string2hex(fill_color)),fill_alpha])
        // }
        // switch (disposition) {
        //     case 1:
        //         this.uniforms.glowColor = new Float32Array([0.0, 0.7019607843137254, 0.0, 1]);
        //         break;
        //     case 0:
        //         this.uniforms.glowColor = new Float32Array([0.0, 0.03529411764705882, 1, 1]);
        //         break;
        //     case -1:
        //         this.uniforms.glowColor = new Float32Array([0.7019607843137254, 0.03529411764705882, 0.0, 1]);
        //         break;
        // }

        // this.uniforms.x = x;
        // this.uniforms.y = y;
        Object.assign(this, {
            outerStrength: 0.5, innerStrength: 0.5, padding: 0, knockout: !1
        });
        this.maskTexture = texture;
        this.maskMatrix = new PIXI.Matrix();

        const t = canvas.app.ticker.lastTime;
        this.uniforms.outerStrength =this.outerStrength * 2.0;// Math.oscillation(this.outerStrength * 1.0, this.outerStrength * 2.0, t, 6000);
        this.uniforms.innerStrength = this.outerStrength * 2.0;//Math.oscillation(this.innerStrength * 1.0, this.innerStrength * 2.0, t, 6000);

        this.updateUniforms(disposition, x, y, enable_outline, outline_color, fill_color, fill_alpha);

    }

    getName() {
        return "TextureMaskFilter";
    }

    updateUniforms(disposition, x, y, enable_outline, outline_color, fill_color, fill_alpha) {
        if (outline_color) {
            this.uniforms.enable_outline = enable_outline;
            this.uniforms.glowColor = new Float32Array(PIXI.utils.hex2rgb(PIXI.utils.string2hex(outline_color)));
            this.uniforms.fill_color = new Float32Array([...PIXI.utils.hex2rgb(PIXI.utils.string2hex(fill_color)), fill_alpha])
        }
        this.uniforms.x = x;
        this.uniforms.y = y;
    }

    calculateSpriteMatrix(outputMatrix, texture, filterManager) {
        // debugger;
        const {sourceFrame, destinationFrame} = filterManager.activeState;
        const {orig} = texture;
        const mappedMatrix = outputMatrix.set(destinationFrame.width, 0, 0, destinationFrame.height, sourceFrame.x, sourceFrame.y);
        const worldTransform = canvas.stage.worldTransform.copyTo(PIXI.Matrix.TEMP_MATRIX);

        worldTransform.invert();
        mappedMatrix.prepend(worldTransform);
        mappedMatrix.scale(1.0 / orig.width/size_reduce, 1.0 / orig.height/size_reduce);
        // mappedMatrix.translate(sprite.anchor.x, sprite.anchor.y);

        return mappedMatrix;
    }

    /**
     * Applies the filter
     * @param filterManager - The renderer to retrieve the filter from
     * @param input - The input render target.
     * @param output - The target to output to.
     * @param clearMode - Should the output be cleared before rendering to it.
     */
    apply(filterManager, input, output, clearMode) {
        const tex = this.maskTexture;


        if ((!tex) || (!tex.valid) || (!tex.baseTexture) ||(tex.baseTexture.destroyed)) {
            console.warn("bad text");
            return;
        }


        if (!tex.uvMatrix) {
            // margin = 0.0, let it bleed a bit, shader code becomes easier
            // assuming that atlas textures were made with 1-pixel padding
            tex.uvMatrix = new PIXI.TextureMatrix(tex, 0.0);
        }
        tex.uvMatrix.update();

        this.uniforms.npmAlpha = tex.baseTexture.alphaMode ? 0.0 : 1.0;
        this.uniforms.mask = tex;
        // get _normalized sprite texture coords_ and convert them to _normalized atlas texture coords_ with `prepend`
        this.uniforms.otherMatrix = this.calculateSpriteMatrix(this.maskMatrix, tex, filterManager)
            .prepend(tex.uvMatrix.mapCoord);
        // this.uniforms.alpha = maskSprite.worldAlpha;
        this.uniforms.maskClamp = tex.uvMatrix.uClampFrame;





        filterManager.applyFilter(this, input, output, clearMode);
    }
}
