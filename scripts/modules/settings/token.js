import {GLOW_FILTER} from "../core/init.js";

import {IsoFaceConfig} from "../core/IsoFace/settings.js";
export  class TokenSettings {
    static

    async _configure_isoface(_this,isoFace, event) {
        event.preventDefault();
        new IsoFaceConfig(_this.object,isoFace, _this).render(true);
        return _this.minimize();
    }
}
function flagToName(flag) {
    return `flags.grape_juice-isometrics.${flag}`
}