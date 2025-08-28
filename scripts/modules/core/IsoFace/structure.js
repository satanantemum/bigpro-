// can be 8d for square, and 6d for hex
// so 8d, cubes, detect hex and disable 2 dirs,
// enable option to mirror so you can use less
// figure out sprite sheet or webms
// actions should change the sprite sheet, or video?
// different sprite sheets, for example laying down, etc

// we will start in 2 stages, first simple not changeable, 8d, no sheets, webm auto play.
// so we create a sheet, that has 8d places to put images,

//NW,N,NE
//W,_,E
//SW,S,SE

import {getBoolFlag, getValueFlag} from "../init.js";

const DIRECTIONS = {
    NW: null, N: null, NE: null, W: null, E: null, SW: null, S: null, SE: null
}

export const TEXTURE_TYPE = {
    IMAGE: "image_class, get path something", VIDEO: "maybe same as image", SPRITESHEET: "something different"
}

export class IsoFaceStructure {
    loadouts
    toggledLoadoutId
    #object_id

    constructor(object) {
        this.#object_id = object.id;
        const isoface = getValueFlag(object, "isoface");
        this.loadLoadout(isoface);

        this.toggledLoadoutId = isoface?.toggledLoadoutId || "default";
    }

    loadLoadout(isoface) {
        this.loadouts = new Map();

        if (isoface?.loadouts) {
            Object.entries(isoface.loadouts).forEach(l => {
                const [id, loadout] = l;
                switch (loadout.loadoutType) {
                    case TEXTURE_TYPE.IMAGE:
                        this.loadouts.set(id, new Image(this.#object_id, loadout.name, loadout.id, loadout.direction_images));
                        break;
                    default:
                        break;

                }
            })


        }
        if (!this.loadouts.has('default')) {
            this.loadouts.set('default', this.getNewLoadout(TEXTURE_TYPE.IMAGE, "Default Loadout", "default"));
        }

    }

    getNewLoadout(Type, name, id = null) {
        let new_image_loadout = new Image(this.#object_id, name, id)

        return  new_image_loadout;
    }

    createNewLoadout(Type, name, id = null) {
        const ret = this.getNewLoadout(Type, name, id);
        this.loadouts.set(ret.id, ret);
    }

    getObject() {
        let ret = foundry.utils.deepClone(this)
        ret.loadouts = Object.fromEntries(ret.loadouts);
        // ret.toggledLoadoutId = this.toggledLoadoutId;

        return ret;
    }



}

class AbstractIsoFaceType {
    id;
    name;
    loadoutType;

    constructor(loadoutType, name, id = null) {
        this.id = id || foundry.utils.randomID();
        this.name = name;
        this.loadoutType = loadoutType;
    }

    GetTexture(direction) {
    }

    GetDirection(token, updateToken) {
    }

    setTokenLoader(token_id, onComplete, onStart) {
    }


}

class Image extends AbstractIsoFaceType {
    direction_images;
    #loader;
    GetTexture(direction) {
        // super.GetTexture(direction);
    }

    constructor(token_id, name, id = null, direction_images = {}) {
        super(TEXTURE_TYPE.IMAGE, name, id);
        this.direction_images = Object.assign({}, DIRECTIONS, direction_images)
        // this.setTokenLoader(token_id)
    }


}