
function getGlowFilter(){
    var h2 = `attribute vec2 aVertexPosition;
attribute vec2 aTextureCoord;

uniform mat3 projectionMatrix;

varying vec2 vTextureCoord;

void main(void)
{
    gl_Position = vec4((projectionMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
    vTextureCoord = aTextureCoord;
}`, f = `varying vec2 vTextureCoord;
varying vec4 vColor;

uniform sampler2D uSampler;

uniform float outerStrength;
uniform float innerStrength;

uniform vec4 glowColor;

uniform vec4 filterArea;
uniform vec4 filterClamp;
uniform bool knockout;

const float PI = 3.14159265358979323846264;

const float DIST = __DIST__;
const float ANGLE_STEP_SIZE = min(__ANGLE_STEP_SIZE__, PI * 2.0);
const float ANGLE_STEP_NUM = ceil(PI * 2.0 / ANGLE_STEP_SIZE);

const float MAX_TOTAL_ALPHA = ANGLE_STEP_NUM * DIST * (DIST + 1.0) / 2.0;

void main(void) {
    vec2 px = vec2(1.0 / filterArea.x, 1.0 / filterArea.y);

    float totalAlpha = 0.0;

    vec2 direction;
    vec2 displaced;
    vec4 curColor;

    for (float angle = 0.0; angle < PI * 2.0; angle += ANGLE_STEP_SIZE) {
       direction = vec2(cos(angle), sin(angle)) * px;

       for (float curDistance = 0.0; curDistance < DIST; curDistance++) {
           displaced = clamp(vTextureCoord + direction * 
                   (curDistance + 1.0), filterClamp.xy, filterClamp.zw);

           curColor = texture2D(uSampler, displaced);

           totalAlpha += (DIST - curDistance) * curColor.a;
       }
    }
    
    curColor = texture2D(uSampler, vTextureCoord);

    float alphaRatio = (totalAlpha / MAX_TOTAL_ALPHA);

    float innerGlowAlpha = (1.0 - alphaRatio) * innerStrength * curColor.a;
    float innerGlowStrength = min(1.0, innerGlowAlpha);
    
    vec4 innerColor = mix(curColor, glowColor, innerGlowStrength);

    float outerGlowAlpha = alphaRatio * outerStrength * (1. - curColor.a);
    float outerGlowStrength = min(1.0 - innerColor.a, outerGlowAlpha);

    vec4 outerGlowColor = outerGlowStrength * glowColor.rgba;
    
    if (knockout) {
      float resultAlpha = outerGlowAlpha + innerGlowAlpha;
      gl_FragColor = vec4(glowColor.rgb * resultAlpha, resultAlpha);
    }
    else {
      gl_FragColor = innerColor + outerGlowColor;
    }
}
`;
    const e = class extends PIXI.Filter {
        constructor(n) {
            const r = Object.assign({}, e.defaults, n), {
                outerStrength: i,
                innerStrength: a,
                color: u,
                knockout: c,
                quality: s
            } = r, o = Math.round(r.distance);
            super(h2, f.replace(/__ANGLE_STEP_SIZE__/gi, `${(1 / s / o).toFixed(7)}`).replace(/__DIST__/gi, `${o.toFixed(0)}.0`)),
                this.uniforms.glowColor = new Float32Array([0, 0, 0, 1]), Object.assign(this, {
                color: u, outerStrength: i, innerStrength: a, padding: o, knockout: c
            })
        }

        apply(filterManager, input, output, clear) {
            const t = canvas.app.ticker.lastTime;
            this.uniforms.outerStrength = Math.oscillation(this.outerStrength * 0.5, this.outerStrength * 2.0, t, 2000);
            this.uniforms.innerStrength = Math.oscillation(this.innerStrength * 0.5, this.innerStrength * 2.0, t, 2000);
            filterManager.applyFilter(this, input, output, clear);
        }

        get color() {
            return PIXI.utils.rgb2hex(this.uniforms.glowColor)
        }

        set color(n) {
            PIXI.utils.hex2rgb(n, this.uniforms.glowColor)
        }

        // get outerStrength() {
        //     return this.uniforms.outerStrength
        // }
        //
        // set outerStrength(n) {
        //     this.uniforms.outerStrength = n
        // }
        //
        // get innerStrength() {
        //     return this.uniforms.innerStrength
        // }
        //
        // set innerStrength(n) {
        //     this.uniforms.innerStrength = n
        // }

        get knockout() {
            return this.uniforms.knockout
        }

        set knockout(n) {
            this.uniforms.knockout = n
        }
    };
    let l = e;
    l.defaults = {distance: 8, outerStrength: 2,
        innerStrength: 2, color: 0xB309FF, quality: .1, knockout: !1,padding:6};

    return new l();
}

